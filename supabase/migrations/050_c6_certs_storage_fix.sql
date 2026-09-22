-- Corrige políticas do bucket c6_certs (upsert precisa de WITH CHECK no UPDATE).
-- Garante que .crt/.key enviados em Configurações › Boleto C6 persistam.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'c6_certs',
  'c6_certs',
  false,
  1048576,
  array['application/x-x509-ca-cert', 'application/pkix-cert', 'application/octet-stream', 'text/plain', '*/*']
)
on conflict (id) do nothing;

drop policy if exists "c6_certs_select_own" on storage.objects;
create policy "c6_certs_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'c6_certs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "c6_certs_insert_own" on storage.objects;
create policy "c6_certs_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'c6_certs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "c6_certs_update_own" on storage.objects;
create policy "c6_certs_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'c6_certs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'c6_certs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "c6_certs_delete_own" on storage.objects;
create policy "c6_certs_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'c6_certs' and (storage.foldername(name))[1] = auth.uid()::text);
