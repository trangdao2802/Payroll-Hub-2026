import test from "node:test";
import assert from "node:assert/strict";
import { encode, decode, digest } from "../src/app/lib/cloud/codec";
import {
  conflictingFields,
  mergeManifest,
  type Manifest,
  type Workspace,
} from "../src/app/lib/cloud/protocol";
import { SyncEngine, OWNER_KEY } from "../src/app/lib/cloud/engine";
import type { CloudRepository } from "../src/app/lib/cloud/repository";
import type { AppData } from "../src/app/types";
const asset = (hash: string) => ({ hash, bytes: 10, parts: [hash] });
const manifest = (fields: Record<string, string>): Manifest => ({
  version: 1,
  fields: Object.fromEntries(
    Object.entries(fields).map(([key, hash]) => [key, asset(hash)]),
  ),
});
test("gzip preserves Vietnamese, undefined, uploaded files and date values", async () => {
  const source = {
    month: "Tháng phát sinh",
    data: [{ amount: 1000 }],
    file: new File(["source data"], "payroll.xlsx", {
      type: "test/plain",
      lastModified: 123,
    }),
    date: new Date("2026-10-01"),
  };
  const compressed = await encode(source);
  const restored = (await decode(compressed)) as typeof source;
  assert.equal(restored.month, source.month);
  assert.deepEqual(restored.data, source.data);
  assert.equal(restored.file.name, "payroll.xlsx");
  assert.equal(await restored.file.text(), "source data");
  assert.equal(restored.date.toISOString(), source.date.toISOString());
  assert.equal(await decode(await encode(undefined)), undefined);
  assert.equal((await digest(compressed)).length, 64);
});
test("Deductions changes merge without overwriting another machine confirmed Batch Payment", () => {
  const base = manifest({ Hold_AE: "hold1", Bank_North_AE: "confirmed1" });
  const local = manifest({ Hold_AE: "hold2", Bank_North_AE: "confirmed1" });
  const remote = manifest({ Hold_AE: "hold1", Bank_North_AE: "confirmed2" });
  assert.deepEqual(conflictingFields(base, local, remote), []);
  assert.equal(
    mergeManifest(base, local, remote).fields.Bank_North_AE.hash,
    "confirmed2",
  );
  assert.equal(mergeManifest(base, local, remote).fields.Hold_AE.hash, "hold2");
});
test("same table edited on two machines conflicts; identical changes do not", () => {
  assert.deepEqual(
    conflictingFields(
      manifest({ Q_Staff: "a" }),
      manifest({ Q_Staff: "b" }),
      manifest({ Q_Staff: "c" }),
    ),
    ["Q_Staff"],
  );
  assert.deepEqual(
    conflictingFields(
      manifest({ Q_Staff: "a" }),
      manifest({ Q_Staff: "b" }),
      manifest({ Q_Staff: "b" }),
    ),
    [],
  );
});
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) || null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
function harness() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  let server: Workspace | null = null;
  const values = new Map<string, unknown>();
  let serial = 0;
  let commits = 0;
  let online = true;
  const repository = (owner = "owner") =>
    ({
      owner,
      dispose() {},
      async cleanup() {},
      async checkMembership() {},
      async read() {
        if (!online) throw new Error("offline test");
        return server ? structuredClone(server) : null;
      },
      async upload(value: unknown) {
        const hash = JSON.stringify(value) || "undefined";
        values.set(hash, structuredClone(value));
        return asset(hash);
      },
      async download(ref: { hash: string }) {
        return structuredClone(values.get(ref.hash));
      },
      async commit(revision: number, next: Manifest) {
        if (revision !== (server?.revision || 0)) throw { code: "P0002" };
        commits++;
        server = {
          owner_id: owner,
          revision: ++serial,
          manifest: structuredClone(next),
          updated_at: new Date().toISOString(),
        };
        return structuredClone(server);
      },
    }) as unknown as CloudRepository;
  function client(initial: Record<string, unknown>) {
    let data = initial;
    const states: unknown[] = [];
    const engine = new SyncEngine(
      repository(),
      () => data as unknown as AppData,
      (updater) => {
        data = updater(data as unknown as AppData) as unknown as Record<
          string,
          unknown
        >;
      },
      (state) => states.push(state),
      async () => {},
    );
    return {
      engine,
      states,
      get data() {
        return data;
      },
      edit(key: string, value: unknown) {
        data = { ...data, [key]: value };
        engine.changed();
      },
    };
  }
  return {
    client,
    setOnline(value: boolean) {
      online = value;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { onLine: value },
      });
    },
    get commits() {
      return commits;
    },
    get server() {
      return server;
    },
    resetDevice() {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: new MemoryStorage(),
      });
    },
  };
}
test("second device restores cloud instead of uploading its empty defaults, then receives changes", async () => {
  const h = harness();
  const first = h.client({
    Q_Staff: ["teacher"],
    Bank_North_AE: { data: ["confirmed"] },
  });
  await first.engine.start();
  assert.equal(h.commits, 1);
  h.resetDevice();
  const second = h.client({ Q_Staff: [], Bank_North_AE: { data: [] } });
  await second.engine.start();
  assert.equal(h.commits, 1);
  assert.deepEqual(second.data.Q_Staff, ["teacher"]);
  first.edit("Q_Staff", ["teacher", "new"]);
  await first.engine.sync();
  await second.engine.sync();
  assert.deepEqual(second.data.Q_Staff, ["teacher", "new"]);
  first.engine.stop();
  second.engine.stop();
});
test("two devices preserve nonoverlapping tables and pause overlapping edits", async () => {
  const h = harness();
  const a = h.client({ Hold_AE: ["initial"], Bank_North_AE: ["confirmed"] });
  await a.engine.start();
  h.resetDevice();
  const b = h.client({ Hold_AE: [], Bank_North_AE: [] });
  await b.engine.start();
  a.edit("Hold_AE", ["deduction"]);
  b.edit("Bank_North_AE", ["confirmed next"]);
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.data.Bank_North_AE, ["confirmed next"]);
  await b.engine.sync();
  a.edit("Hold_AE", ["machine a"]);
  b.edit("Hold_AE", ["machine b"]);
  await a.engine.sync();
  await b.engine.sync();
  assert.equal((b.states.at(-1) as { status: string }).status, "conflict");
  await b.engine.resolve(false);
  assert.deepEqual(b.data.Hold_AE, ["machine a"]);
  a.engine.stop();
  b.engine.stop();
});
test("different account cannot upload another account cached data", async () => {
  const h = harness();
  localStorage.setItem(OWNER_KEY, "other");
  const a = h.client({ Q_Staff: ["private payroll"] });
  await a.engine.start();
  assert.equal(h.commits, 0);
  assert.equal((a.states.at(-1) as { status: string }).status, "error");
  a.engine.stop();
});

test("offline edits survive reopening and upload when connection returns", async () => {
  const h = harness();
  const first = h.client({ Q_Staff: ["saved"], Bank_North_AE: ["confirmed"] });
  await first.engine.start();
  h.setOnline(false);
  first.edit("Q_Staff", ["offline edit"]);
  await first.engine.sync();
  first.engine.stop();
  const reopened = h.client({
    Q_Staff: ["offline edit"],
    Bank_North_AE: ["confirmed"],
  });
  await reopened.engine.start();
  assert.equal(
    (reopened.states.at(-1) as { status: string }).status,
    "offline",
  );
  assert.equal(h.commits, 1);
  h.setOnline(true);
  await reopened.engine.retry();
  assert.equal(h.commits, 2);
  assert.equal(
    h.server?.manifest.fields.Q_Staff.hash,
    JSON.stringify(["offline edit"]),
  );
  reopened.engine.stop();
});
