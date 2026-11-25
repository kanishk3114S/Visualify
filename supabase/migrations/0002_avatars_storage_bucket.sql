-- =============================================================================
-- Visualify Phase 1 - 0002: private avatars bucket + storage.objects policies
-- =============================================================================
-- Idempotent. PRD refs: Section 10.6 (buckets/paths), 12.2 (upload security).
-- Object path convention: {uid}/avatar-{uuid}.webp
-- The Express API re-encodes every upload to WebP, so only image/webp objects
-- are ever written; jpeg/png stay allowed at the bucket level per the PRD.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects is enabled by Supabase; policies below are additive
-- and only ever match the avatars bucket inside the caller's own folder.

drop policy if exists "Avatar owners can read their avatars" on storage.objects;
create policy "Avatar owners can read their avatars"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Avatar owners can upload their avatars" on storage.objects;
create policy "Avatar owners can upload their avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ (
      '^' || (select auth.uid())::text
      || '/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    )
  );

drop policy if exists "Avatar owners can update their avatars" on storage.objects;
create policy "Avatar owners can update their avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ (
      '^' || (select auth.uid())::text
      || '/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    )
  );

drop policy if exists "Avatar owners can delete their avatars" on storage.objects;
create policy "Avatar owners can delete their avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
