-- Compressed working data lives in private Storage, not in the database.
create schema if not exists payroll_private;
revoke all on schema payroll_private from public, anon;
grant usage on schema payroll_private to authenticated;
create table public.payroll_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  manifest jsonb not null,
  previous_manifest jsonb,
  updated_at timestamptz not null default now()
);
alter table public.payroll_workspaces enable row level security;
revoke all on public.payroll_workspaces from anon, authenticated;
grant select on public.payroll_workspaces to authenticated;
create policy payroll_workspace_read on public.payroll_workspaces for select to authenticated
using (owner_id = (select auth.uid()) and exists (select 1 from public.transaction_history_members m where m.user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payroll-workspaces', 'payroll-workspaces', false, 4194304, array['application/octet-stream'])
on conflict (id) do nothing;
create policy payroll_objects_read on storage.objects for select to authenticated
using (bucket_id = 'payroll-workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.transaction_history_members m where m.user_id = (select auth.uid())));
create policy payroll_objects_insert on storage.objects for insert to authenticated
with check (bucket_id = 'payroll-workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[a-f0-9]{64}/[0-9]{6}\.part$')
  and exists (select 1 from public.transaction_history_members m where m.user_id = (select auth.uid())));
create policy payroll_objects_delete on storage.objects for delete to authenticated
using (bucket_id = 'payroll-workspaces' and (storage.foldername(name))[1] = (select auth.uid())::text
  and created_at < now() - interval '1 day'
  and exists (select 1 from public.transaction_history_members m where m.user_id = (select auth.uid()))
  and not exists (
    select 1 from public.payroll_workspaces w,
      lateral (values (w.manifest), (w.previous_manifest)) versions(manifest),
      lateral jsonb_each(coalesce(versions.manifest->'fields','{}'::jsonb)) f
    where w.owner_id = (select auth.uid()) and (f.value->'parts') ? storage.objects.name
  ));

create function payroll_private.commit_payroll_workspace(expected_revision bigint, new_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); current_row public.payroll_workspaces;
  field record; part jsonb; total bigint := 0; bytes bigint; part_count integer; actual bigint; position integer;
begin
  if uid is null or not exists (select 1 from public.transaction_history_members where user_id = uid) then
    raise exception 'Payroll membership required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
  select * into current_row from public.payroll_workspaces where owner_id = uid for update;
  if coalesce(current_row.revision, 0) <> expected_revision then
    raise exception 'Workspace changed on another device' using errcode = 'P0002';
  end if;
  if new_manifest->>'version' is distinct from '1' or jsonb_typeof(new_manifest->'fields') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(new_manifest->'fields')) > 100 then
    raise exception 'Invalid workspace manifest';
  end if;
  for field in select * from jsonb_each(new_manifest->'fields') loop
    if field.key !~ '^[A-Za-z][A-Za-z0-9_]{0,80}$'
      or field.value->>'hash' !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(field.value->'parts') is distinct from 'array' then raise exception 'Invalid asset'; end if;
    bytes := (field.value->>'bytes')::bigint;
    if bytes is null or bytes <= 0 or bytes > 209715200 then raise exception 'Invalid asset size'; end if;
    part_count := jsonb_array_length(field.value->'parts');
    if part_count <> (bytes + 4194303) / 4194304 then raise exception 'Invalid part count'; end if;
    total := total + bytes; position := 0;
    for part in select value from jsonb_array_elements(field.value->'parts') loop
      if part #>> '{}' is distinct from uid::text || '/' || (field.value->>'hash') || '/' || lpad(position::text,6,'0') || '.part' then
        raise exception 'Invalid owner or part path';
      end if;
      select (metadata->>'size')::bigint into actual from storage.objects
        where bucket_id = 'payroll-workspaces' and name = part #>> '{}';
      if actual is distinct from least(4194304::bigint, bytes - position::bigint * 4194304) then raise exception 'Missing or incomplete asset'; end if;
      position := position + 1;
    end loop;
  end loop;
  if total > 209715200 then raise exception 'Working data exceeds 200 MB compressed. Local data is retained.'; end if;
  insert into public.payroll_workspaces(owner_id, revision, manifest, previous_manifest, updated_at)
  values(uid, expected_revision + 1, new_manifest, current_row.manifest, now())
  on conflict(owner_id) do update set revision = excluded.revision, manifest = excluded.manifest,
    previous_manifest = excluded.previous_manifest, updated_at = excluded.updated_at
  returning * into current_row;
  return jsonb_build_object('owner_id',current_row.owner_id,'revision',current_row.revision,'manifest',current_row.manifest,'updated_at',current_row.updated_at);
end;
$$;
revoke all on function payroll_private.commit_payroll_workspace(bigint,jsonb) from public, anon;
grant execute on function payroll_private.commit_payroll_workspace(bigint,jsonb) to authenticated;
create function public.commit_payroll_workspace(expected_revision bigint, new_manifest jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select payroll_private.commit_payroll_workspace(expected_revision, new_manifest);
$$;
revoke all on function public.commit_payroll_workspace(bigint,jsonb) from public, anon;
grant execute on function public.commit_payroll_workspace(bigint,jsonb) to authenticated;
