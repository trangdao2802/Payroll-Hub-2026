-- Keep the anonymous Auth guard visible to policy audits as well as in the helper.
alter policy payroll_objects_delete on storage.objects using (
 bucket_id='payroll-workspaces'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select coalesce(auth.jwt()->>'is_anonymous','false'))='false'
 and payroll_private.can_delete_payroll_asset(name)
);
