-- Serialize cleanup with commits. A file newly referenced by a commit cannot be deleted.
create function payroll_private.can_delete_payroll_asset(object_name text)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare uid uuid := auth.uid();
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false'
   or split_part(object_name,'/',1) <> uid::text
   or not exists(select 1 from public.transaction_history_members where user_id=uid) then return false; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
 return exists(select 1 from storage.objects where bucket_id='payroll-workspaces' and name=object_name and created_at<now()-interval '15 minutes')
   and not exists(select 1 from public.payroll_workspaces w,
     lateral (values(w.manifest),(w.previous_manifest)) versions(manifest),
     lateral jsonb_each(coalesce(versions.manifest->'fields','{}'::jsonb)) f
     where w.owner_id=uid and (f.value->'parts') ? object_name);
end; $$;
revoke all on function payroll_private.can_delete_payroll_asset(text) from public, anon;
grant execute on function payroll_private.can_delete_payroll_asset(text) to authenticated;
alter policy payroll_objects_delete on storage.objects using (
 bucket_id='payroll-workspaces' and (storage.foldername(name))[1]=(select auth.uid())::text
 and payroll_private.can_delete_payroll_asset(name));

create function public.payroll_orphan_assets()
returns table(path text) language sql stable security invoker set search_path = '' as $$
 select o.name from storage.objects o
 where o.bucket_id='payroll-workspaces' and split_part(o.name,'/',1)=(select auth.uid())::text
   and o.created_at<now()-interval '15 minutes'
   and not exists(select 1 from public.payroll_workspaces w,
     lateral (values(w.manifest),(w.previous_manifest)) versions(manifest),
     lateral jsonb_each(coalesce(versions.manifest->'fields','{}'::jsonb)) f
     where w.owner_id=(select auth.uid()) and (f.value->'parts') ? o.name)
 order by o.created_at limit 200;
$$;
revoke all on function public.payroll_orphan_assets() from public, anon;
grant execute on function public.payroll_orphan_assets() to authenticated;
-- Anonymous Auth users are different from the anon API role and are explicitly excluded.
alter policy payroll_workspace_read on public.payroll_workspaces using (
 owner_id=(select auth.uid()) and (select coalesce(auth.jwt()->>'is_anonymous','false'))='false'
 and exists(select 1 from public.transaction_history_members m where m.user_id=(select auth.uid())));
alter policy payroll_objects_read on storage.objects using (
 bucket_id='payroll-workspaces' and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select coalesce(auth.jwt()->>'is_anonymous','false'))='false'
 and exists(select 1 from public.transaction_history_members m where m.user_id=(select auth.uid())));

alter policy payroll_objects_insert on storage.objects with check (
 bucket_id='payroll-workspaces' and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select coalesce(auth.jwt()->>'is_anonymous','false'))='false'
 and name ~ ('^' || (select auth.uid())::text || '/[a-f0-9]{64}/[0-9]{6}\.part$')
 and exists(select 1 from public.transaction_history_members m where m.user_id=(select auth.uid())));

create or replace function payroll_private.commit_payroll_workspace(expected_revision bigint, new_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); current_row public.payroll_workspaces;
  field record; part jsonb; total bigint := 0; bytes bigint; part_count integer; actual bigint; position integer;
begin
  if uid is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false' or not exists (select 1 from public.transaction_history_members where user_id = uid) then
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
