-- Endereço completo + caminho do PDF no Storage
-- Execute após 001_initial.sql

alter table public.clientes add column if not exists cep text;
alter table public.clientes add column if not exists logradouro text;
alter table public.clientes add column if not exists numero text;
alter table public.clientes add column if not exists complemento text;
alter table public.clientes add column if not exists bairro text;
alter table public.clientes add column if not exists cidade text;
alter table public.clientes add column if not exists uf text;
alter table public.clientes add column if not exists pdf_path text;

-- Bucket privado para anexos PDF (caminho: {user_id}/{cliente_id}/arquivo.pdf)
insert into storage.buckets (id, name, public)
values ('clientes-pdfs', 'clientes-pdfs', false)
on conflict (id) do nothing;

-- Políticas do Storage: cada usuário só acessa pasta com seu auth.uid()
drop policy if exists "clientes_pdfs_select_own" on storage.objects;
create policy "clientes_pdfs_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'clientes-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "clientes_pdfs_insert_own" on storage.objects;
create policy "clientes_pdfs_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'clientes-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "clientes_pdfs_update_own" on storage.objects;
create policy "clientes_pdfs_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'clientes-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'clientes-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "clientes_pdfs_delete_own" on storage.objects;
create policy "clientes_pdfs_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'clientes-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
