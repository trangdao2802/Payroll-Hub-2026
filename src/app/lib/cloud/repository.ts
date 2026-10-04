import { supabase } from "../../../lib/supabaseClient";
import {
  BUCKET,
  PART_SIZE,
  type Asset,
  type Manifest,
  type Workspace,
} from "./protocol";
import { digest } from "./codec";
export class CloudRepository {
  private worker = new Worker(new URL("./codec.worker.ts", import.meta.url), {
    type: "module",
  });
  private counter = 0;
  private pending = new Map<
    number,
    {
      resolve: (result: { result: unknown; hash?: string }) => void;
      reject: (error: Error) => void;
    }
  >();
  constructor(readonly owner: string) {
    this.worker.onerror = () => {
      for (const task of this.pending.values())
        task.reject(new Error("Không thể nén dữ liệu. Thử tải lại trang."));
      this.pending.clear();
    };
    this.worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) task?.reject(new Error(data.error));
      else task?.resolve(data);
    };
  }
  dispose() {
    this.worker.terminate();
    for (const task of this.pending.values())
      task.reject(new Error("Đã đổi tài khoản"));
    this.pending.clear();
  }
  private codec(operation: "encode" | "decode", value: unknown) {
    return new Promise<{ result: unknown; hash?: string }>(
      (resolve, reject) => {
        const id = ++this.counter;
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ id, operation, value });
      },
    );
  }
  async read(): Promise<Workspace | null> {
    const { data, error } = await supabase
      .from("payroll_workspaces")
      .select("owner_id,revision,manifest,updated_at")
      .eq("owner_id", this.owner)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  async checkMembership() {
    const { data, error } = await supabase
      .from("transaction_history_members")
      .select("user_id")
      .eq("user_id", this.owner)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new Error("Tài khoản chưa được cấp quyền dữ liệu Payroll.");
  }
  async upload(value: unknown): Promise<Asset> {
    const { result, hash } = await this.codec("encode", value);
    const blob = result as Blob;
    if (blob.size > 200 * 1024 * 1024)
      throw new Error(
        "Một bảng vượt 200 MB sau nén. Dữ liệu máy này vẫn được giữ.",
      );
    const parts: string[] = [];
    for (let offset = 0; offset < blob.size; offset += PART_SIZE) {
      const path = `${this.owner}/${hash}/${String(parts.length).padStart(6, "0")}.part`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob.slice(offset, offset + PART_SIZE), {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (
        error &&
        !("statusCode" in error && String(error.statusCode) === "409") &&
        !/already exists|duplicate/i.test(error.message)
      )
        throw error;
      parts.push(path);
    }
    return { hash: hash!, bytes: blob.size, parts };
  }
  async download(asset: Asset): Promise<unknown> {
    const blobs: Blob[] = [];
    for (const path of asset.parts) {
      if (!path.startsWith(`${this.owner}/${asset.hash}/`))
        throw new Error("Đường dẫn cloud không hợp lệ");
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(path);
      if (error) throw error;
      blobs.push(data);
    }
    const blob = new Blob(blobs);
    if (blob.size !== asset.bytes || (await digest(blob)) !== asset.hash)
      throw new Error("Dữ liệu cloud chưa đầy đủ. Bản trên máy vẫn được giữ.");
    return (await this.codec("decode", blob)).result;
  }
  async cleanup() {
    const { data, error } = await supabase.rpc("payroll_orphan_assets");
    if (error || !data?.length) return;
    const paths = (data as { path: string }[])
      .map((item) => item.path)
      .filter((path) => path.startsWith(`${this.owner}/`));
    for (let offset = 0; offset < paths.length; offset += 100) {
      const result = await supabase.storage
        .from(BUCKET)
        .remove(paths.slice(offset, offset + 100));
      if (result.error) return;
    }
  }
  async commit(revision: number, manifest: Manifest): Promise<Workspace> {
    const { data, error } = await supabase.rpc("commit_payroll_workspace", {
      expected_revision: revision,
      new_manifest: manifest,
    });
    if (error) throw error;
    return data;
  }
}
