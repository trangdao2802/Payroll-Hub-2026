import { INITIAL_APP_DATA } from "../../constants/initial-data";
import type { AppData } from "../../types";
import {
  type Manifest,
  type Workspace,
  conflictingFields,
  mergeManifest,
} from "./protocol";
import { CloudRepository } from "./repository";
export type SyncStatus =
  | "starting"
  | "saving"
  | "synced"
  | "offline"
  | "conflict"
  | "error";
export interface SyncState {
  status: SyncStatus;
  message?: string;
  conflicts?: string[];
  updatedAt?: string;
}
export const OWNER_KEY = "payroll_cloud_cache_owner";
const EMPTY: Manifest = { version: 1, fields: {} };
const checkpointKey = (owner: string) => `payroll_cloud_checkpoint:${owner}`;
export class SyncEngine {
  private base: Workspace | null = null;
  private refs: Record<string, unknown> = {};
  private dirty = new Set<string>();
  private running = false;
  private stopped = false;
  private ready = false;
  private applying = false;
  private initializing = false;
  private timer?: ReturnType<typeof setTimeout>;
  private conflictRemote: Workspace | null = null;
  private staged: Manifest | null = null;
  constructor(
    private repository: CloudRepository,
    private getData: () => AppData,
    private apply: (updater: (data: AppData) => AppData) => void,
    private report: (state: SyncState) => void,
    private backup: () => Promise<void>,
  ) {}
  private checkpoint() {
    localStorage.setItem(
      checkpointKey(this.repository.owner),
      JSON.stringify({ base: this.base, dirty: [...this.dirty] }),
    );
  }
  private async install(remote: Workspace, fields: string[], replace = false) {
    const patch: Record<string, unknown> = {};
    for (const key of fields)
      patch[key] = await this.repository.download(remote.manifest.fields[key]);
    if (this.stopped) return;
    this.applying = true;
    // Preserve edits made while the download was in flight.
    this.apply((current) => {
      const next = {
        ...(replace ? { ...INITIAL_APP_DATA, Timesheet_Roster: [] } : current),
      } as Record<string, unknown>;
      for (const key of fields) {
        if (!this.dirty.has(key)) {
          next[key] = patch[key];
          this.refs[key] = patch[key];
        }
      }
      return next as unknown as AppData;
    });
    this.applying = false;
  }
  async retry() {
    if (this.ready) await this.sync();
    else await this.start();
  }
  async start() {
    if (this.initializing || this.stopped) return;
    this.initializing = true;
    this.report({ status: "starting" });
    try {
      await this.repository.checkMembership();
      const owner = localStorage.getItem(OWNER_KEY);
      if (owner && owner !== this.repository.owner)
        throw new Error(
          "Máy này có dữ liệu của tài khoản khác. Đăng nhập lại tài khoản đã lưu dữ liệu để tránh trộn dữ liệu.",
        );
      const stored =
        owner === this.repository.owner
          ? localStorage.getItem(checkpointKey(owner))
          : null;
      const checkpoint = stored ? JSON.parse(stored) : null;
      const remote = await this.repository.read();
      if (this.stopped) return;
      this.refs = { ...this.getData() };
      if (checkpoint?.base) {
        this.base = checkpoint.base;
        this.dirty = new Set(checkpoint.dirty || []);
        // A tab may have closed before IndexedDB finished writing a cloud pull.
        // Restore clean fields, while keeping the baseline of pending offline edits.
        if (remote) {
          const clean = Object.keys(remote.manifest.fields).filter(
            (key) => !this.dirty.has(key),
          );
          await this.install(remote, clean);
          const fields = { ...this.base!.manifest.fields };
          for (const key of clean) fields[key] = remote.manifest.fields[key];
          this.base = { ...remote, manifest: { version: 1, fields } };
        }
      } else if (remote) {
        // A first login on another computer restores the cloud; it never uploads defaults.
        if (!owner || owner === this.repository.owner) await this.backup();
        await this.install(remote, Object.keys(remote.manifest.fields), true);
        this.base = remote;
      } else if (owner && owner !== this.repository.owner) {
        throw new Error(
          "Tài khoản này chưa có dữ liệu cloud. Đăng nhập lại tài khoản đã lưu dữ liệu trên máy.",
        );
      } else {
        Object.keys(this.getData()).forEach((key) => this.dirty.add(key));
      }
      if (this.stopped) return;
      localStorage.setItem(OWNER_KEY, this.repository.owner);
      this.ready = true;
      this.checkpoint();
      await this.sync();
    } catch (error) {
      if (
        !navigator.onLine &&
        localStorage.getItem(OWNER_KEY) === this.repository.owner
      ) {
        const cached = localStorage.getItem(
          checkpointKey(this.repository.owner),
        );
        if (cached) {
          const checkpoint = JSON.parse(cached);
          this.base = checkpoint.base;
          this.refs = { ...this.getData() };
          this.dirty = new Set(checkpoint.dirty || []);
          this.ready = true;
        }
      }
      this.fail(error);
    } finally {
      this.initializing = false;
    }
  }
  changed() {
    if (!this.ready || this.stopped || this.applying) return;
    const data = this.getData() as unknown as Record<string, unknown>;
    for (const key of new Set([
      ...Object.keys(data),
      ...Object.keys(this.refs),
    ])) {
      if (data[key] !== this.refs[key]) this.dirty.add(key);
    }
    this.checkpoint();
    if (this.dirty.size && !this.conflictRemote) {
      this.report({
        status: navigator.onLine ? "saving" : "offline",
        message: "Thay đổi trên máy đang chờ đồng bộ.",
      });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.sync(), 3500);
    }
  }
  private fail(error: unknown) {
    if (this.stopped) return;
    this.report({
      status: navigator.onLine ? "error" : "offline",
      message:
        error instanceof Error
          ? error.message
          : String(
              (error as { message?: string })?.message ||
                "Không thể đồng bộ. Dữ liệu trên máy vẫn được giữ.",
            ),
    });
  }
  async sync() {
    if (!this.ready || this.running || this.stopped || this.conflictRemote)
      return;
    this.running = true;
    try {
      let remote = await this.repository.read();
      if (this.stopped) return;
      const snapshot = { ...this.getData() } as unknown as Record<
        string,
        unknown
      >;
      const pending = [...this.dirty];
      const local: Manifest = {
        version: 1,
        fields: { ...(this.base?.manifest.fields || {}) },
      };
      if (pending.length) {
        this.report({ status: "saving" });
        await this.repository.cleanup().catch(() => undefined);
      }
      for (const key of pending) {
        local.fields[key] = await this.repository.upload(snapshot[key]);
        if (this.stopped) return;
      }
      // Refresh after uploads: another computer may have committed meanwhile.
      if (pending.length) remote = await this.repository.read();
      if (this.stopped) return;
      const conflicts = conflictingFields(
        this.base?.manifest || EMPTY,
        local,
        remote?.manifest || EMPTY,
      );
      if (conflicts.length && remote) {
        this.conflictRemote = remote;
        this.staged = local;
        this.report({
          status: "conflict",
          conflicts,
          message: "Hai máy đã sửa cùng phần dữ liệu. Chọn bản cần giữ.",
        });
        return;
      }
      const incoming = Object.keys(remote?.manifest.fields || {}).filter(
        (key) =>
          !this.dirty.has(key) &&
          remote?.manifest.fields[key]?.hash !==
            this.base?.manifest.fields[key]?.hash,
      );
      if (remote && incoming.length) await this.install(remote, incoming);
      if (this.stopped) return;
      let committed = remote;
      if (pending.length)
        committed = await this.repository.commit(
          remote?.revision || 0,
          mergeManifest(
            this.base?.manifest || EMPTY,
            local,
            remote?.manifest || EMPTY,
          ),
        );
      if (this.stopped) return;
      for (const key of pending) {
        this.refs[key] = snapshot[key];
        if (
          (this.getData() as unknown as Record<string, unknown>)[key] ===
          snapshot[key]
        )
          this.dirty.delete(key);
      }
      this.base = committed;
      this.checkpoint();
      if (pending.length) void this.repository.cleanup().catch(() => undefined);
      this.report({
        status: this.dirty.size ? "saving" : "synced",
        updatedAt: committed?.updated_at,
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P0002")
        this.timer = setTimeout(() => void this.sync(), 1000);
      else this.fail(error);
    } finally {
      this.running = false;
      if (this.dirty.size && !this.conflictRemote && !this.stopped) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.sync(), 10000);
      }
    }
  }
  async resolve(keepLocal: boolean) {
    const remote = this.conflictRemote;
    if (!remote || this.running) return;
    await this.backup();
    if (this.stopped) return;
    const conflicts = conflictingFields(
      this.base?.manifest || EMPTY,
      this.staged!,
      remote.manifest,
    );
    if (!keepLocal) {
      for (const key of conflicts) this.dirty.delete(key);
      await this.install(remote, conflicts);
    }
    // Rebase only the conflict keys; unrelated remote and local updates still merge normally.
    const fields = { ...(this.base?.manifest.fields || {}) };
    for (const key of conflicts) fields[key] = remote.manifest.fields[key];
    this.base = { ...remote, manifest: { version: 1, fields } };
    this.conflictRemote = null;
    this.staged = null;
    this.checkpoint();
    await this.sync();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.repository.dispose();
  }
}
