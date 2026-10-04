import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("cloud RLS, complete uploads, immutable assets and compare-and-swap protect payroll", async () => {
  const db = new PGlite();
  const owner = "00000000-0000-0000-0000-000000000001",
    other = "00000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
   create table public.transaction_history_members(user_id uuid primary key);
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text,name text,metadata jsonb,created_at timestamptz default now());
   alter table storage.objects enable row level security;
   create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
   grant usage on schema auth,storage,public to anon,authenticated;
   grant select on public.transaction_history_members to authenticated;
   grant select,insert,update,delete on storage.objects to authenticated;
   insert into auth.users values ('${owner}'),('${other}'); insert into public.transaction_history_members values ('${owner}');`);
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261004040037_payroll_cloud_workspace_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261004041803_payroll_cloud_safe_cleanup.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`,
    );
    const hash = "a".repeat(64),
      path = `${owner}/${hash}/000000.part`;
    const payload = {
      version: 1,
      fields: { Bank_North_AE: { hash, bytes: 10, parts: [path] } },
    };
    const commit = (revision: number, value = payload) =>
      db.query(
        "select public.commit_payroll_workspace($1,$2::jsonb) as result",
        [revision, JSON.stringify(value)],
      );
    await assert.rejects(commit(0), /Missing or incomplete asset/);
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3::jsonb)",
      ["payroll-workspaces", path, JSON.stringify({ size: 10 })],
    );
    await commit(0);
    assert.equal(
      (await db.query("select revision from public.payroll_workspaces")).rows[0]
        .revision,
      1,
    );
    await assert.rejects(commit(0), { code: "P0002" });
    await assert.rejects(
      db.exec("update public.payroll_workspaces set revision=10"),
    );
    assert.equal(
      (
        await db.query(
          "update storage.objects set metadata='{\"size\":1}' returning name",
        )
      ).rows.length,
      0,
    );
    await db.exec(
      `reset role; update storage.objects set created_at=now()-interval '2 days'; set role authenticated`,
    );
    assert.equal(
      (await db.query("delete from storage.objects returning name")).rows
        .length,
      0,
    );
    await commit(1);
    const bHash = "b".repeat(64),
      cHash = "c".repeat(64);
    await db.exec(`reset role; insert into storage.objects(bucket_id,name,metadata,created_at) values
    ('payroll-workspaces','${owner}/${bHash}/000000.part','{"size":10}',now()-interval '2 days'),
    ('payroll-workspaces','${owner}/${cHash}/000000.part','{"size":10}',now()-interval '2 days'); set role authenticated;`);
    const bPayload = {
      version: 1,
      fields: {
        Bank_North_AE: {
          hash: bHash,
          bytes: 10,
          parts: [`${owner}/${bHash}/000000.part`],
        },
      },
    };
    const cPayload = {
      version: 1,
      fields: {
        Bank_North_AE: {
          hash: cHash,
          bytes: 10,
          parts: [`${owner}/${cHash}/000000.part`],
        },
      },
    };
    await commit(2, bPayload);
    await commit(3, cPayload);
    assert.equal(
      (await db.query("select * from public.payroll_orphan_assets()")).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query("delete from storage.objects returning name")).rows
        .length,
      1,
      "cleanup deletes only assets outside current and previous versions",
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      2,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${other}',false)`,
    );
    assert.equal(
      (await db.query("select * from public.payroll_workspaces")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await assert.rejects(commit(2), { code: "42501" });
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3::jsonb)",
        ["payroll-workspaces", path, JSON.stringify({ size: 10 })],
      ),
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(commit(2));
    await assert.rejects(db.query("select * from public.payroll_workspaces"));
  } finally {
    await db.close();
  }
});
