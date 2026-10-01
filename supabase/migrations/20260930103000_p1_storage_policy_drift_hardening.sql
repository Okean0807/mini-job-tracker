-- P1: make the private documents bucket and its ownership policies explicit
-- in the migration chain so a fresh Supabase project cannot drift from the
-- production security boundary.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read own document files" on storage.objects;
drop policy if exists "Users upload own document files" on storage.objects;
drop policy if exists "Users update own document files" on storage.objects;
drop policy if exists "Users delete own document files" on storage.objects;

create policy "Users read own document files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users upload own document files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users update own document files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users delete own document files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);
