-- Certificado A1 — setup completo (rode só este arquivo no SQL Editor).
-- Cria tabelas, bucket de storage e permissões para upload pelo app.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.empresa_certificado (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  valido_ate date,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_empresa_certificado_user_ativo
  on public.empresa_certificado (user_id)
  where ativo = true;

create table if not exists public.empresa_certificado_secreto (
  certificado_id uuid primary key references public.empresa_certificado (id) on delete cascade,
  senha_criptografada text not null
);

create table if not exists public.app_runtime_config (
  key text primary key,
  value text not null
);

alter table public.empresa_certificado enable row level security;
alter table public.empresa_certificado_secreto enable row level security;
alter table public.app_runtime_config enable row level security;

-- ---------------------------------------------------------------------------
-- Storage: arquivo .pfx
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('empresa_certificados', 'empresa_certificados', false)
on conflict (id) do nothing;

drop policy if exists "nfe_cert_select_own" on storage.objects;
create policy "nfe_cert_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'empresa_certificados' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "nfe_cert_insert_own" on storage.objects;
create policy "nfe_cert_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'empresa_certificados' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "nfe_cert_delete_own" on storage.objects;
create policy "nfe_cert_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'empresa_certificados' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- RLS: certificado e senha (próprio usuário)
-- ---------------------------------------------------------------------------
drop policy if exists "empresa_certificado_own" on public.empresa_certificado;
create policy "empresa_certificado_own"
  on public.empresa_certificado for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "empresa_certificado_secreto_own" on public.empresa_certificado_secreto;
create policy "empresa_certificado_secreto_own"
  on public.empresa_certificado_secreto for all
  to authenticated
  using (
    exists (
      select 1 from public.empresa_certificado c
      where c.id = certificado_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.empresa_certificado c
      where c.id = certificado_id and c.user_id = auth.uid()
    )
  );

-- Chave de criptografia (só registro cert_encryption_key).
drop policy if exists "app_runtime_config_select_cert_key" on public.app_runtime_config;
create policy "app_runtime_config_select_cert_key"
  on public.app_runtime_config for select
  to authenticated
  using (key = 'cert_encryption_key');

drop policy if exists "app_runtime_config_insert_cert_key" on public.app_runtime_config;
create policy "app_runtime_config_insert_cert_key"
  on public.app_runtime_config for insert
  to authenticated
  with check (
    key = 'cert_encryption_key'
    and length(trim(value)) >= 16
    and not exists (
      select 1 from public.app_runtime_config ar where ar.key = 'cert_encryption_key'
    )
  );

notify pgrst, 'reload schema';
