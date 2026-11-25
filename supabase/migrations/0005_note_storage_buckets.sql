-- =============================================================================
-- Visualify Phase 3 - 0005: private note-assets / note-exports buckets
-- =============================================================================
-- Idempotent. PRD refs: 10.6 (buckets & object paths), 12.2.
--   note-assets   {uid}/{noteId}/{versionId}/preview.png
--   note-exports  {uid}/{noteId}/{versionId}/export-{exportId}.{png|svg|excalidraw}
-- Only object PATHS are stored in Postgres; downloads use short-lived signed
-- URLs generated per request after ownership checks.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('note-assets', 'note-assets', false, 5242880, array['image/png']),
  ('note-exports', 'note-exports', false, 26214400, array['image/png', 'image/svg+xml', 'application/json'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read/delete: anything in the caller's own top-level folder of these buckets.
drop policy if exists "Note file owners can read" on storage.objects;
create policy "Note file owners can read"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('note-assets', 'note-exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Note file owners can delete" on storage.objects;
create policy "Note file owners can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('note-assets', 'note-exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Write: own folder AND the second segment must be one of the caller's notes.
drop policy if exists "Note file owners can upload" on storage.objects;
create policy "Note file owners can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('note-assets', 'note-exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.notes n
      where n.id::text = (storage.foldername(name))[2] and n.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Note file owners can update" on storage.objects;
create policy "Note file owners can update"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('note-assets', 'note-exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('note-assets', 'note-exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.notes n
      where n.id::text = (storage.foldername(name))[2] and n.owner_id = (select auth.uid())
    )
  );
