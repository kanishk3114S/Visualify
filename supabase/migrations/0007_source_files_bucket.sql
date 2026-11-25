-- =============================================================================
-- Visualify Phase 4 - 0007: private source-files Storage bucket
-- =============================================================================
-- Idempotent. PRD refs: 5.4, 10.6 (source-files bucket), 12.2.
--   source-files  {uid}/{sourceFileId}/original.{ext}
-- Private bucket (20 MiB max), allowlisted PDF/JPEG/PNG/WebP MIME types.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-files',
  'source-files',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Source file owners can read" on storage.objects;
create policy "Source file owners can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Source file owners can upload" on storage.objects;
create policy "Source file owners can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Source file owners can update" on storage.objects;
create policy "Source file owners can update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Source file owners can delete" on storage.objects;
create policy "Source file owners can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
