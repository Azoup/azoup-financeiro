-- Integração C6 Bank: banco por CNPJ emitente + metadados de boleto registrado.

-- Banco de cobrança por emitente (CNPJ antigo = sicoob, novo = c6).
alter table public.nfse_emitente
  add column if not exists banco_cobranca text not null default 'sicoob'
    check (banco_cobranca in ('sicoob', 'c6'));

comment on column public.nfse_emitente.banco_cobranca is
  'Banco usado ao emitir boleto deste CNPJ: sicoob (legado) ou c6.';

-- Emitente padrão / primeiro → Sicoob; demais → C6.
update public.nfse_emitente e
set banco_cobranca = 'c6'
where e.padrao = false
  and exists (
    select 1 from public.nfse_emitente o
    where o.user_id = e.user_id and o.padrao = true and o.id <> e.id
  );

create table if not exists public.config_c6 (
  user_id uuid not null references auth.users (id) on delete cascade,
  emitente_id uuid not null references public.nfse_emitente (id) on delete cascade,
  ativo boolean not null default false,
  ambiente text not null default 'sandbox' check (ambiente in ('sandbox', 'producao')),
  client_id text not null default '',
  client_secret text not null default '',
  billing_scheme text not null default '21',
  cert_crt_storage_path text,
  cert_key_storage_path text,
  webhook_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, emitente_id),
  unique (emitente_id)
);

drop trigger if exists tr_config_c6_updated on public.config_c6;
create trigger tr_config_c6_updated
before update on public.config_c6
for each row execute procedure public.set_updated_at();

alter table public.config_c6 enable row level security;

drop policy if exists "config_c6_select_own" on public.config_c6;
create policy "config_c6_select_own"
  on public.config_c6 for select
  using (auth.uid() = user_id);

drop policy if exists "config_c6_insert_own" on public.config_c6;
create policy "config_c6_insert_own"
  on public.config_c6 for insert
  with check (auth.uid() = user_id);

drop policy if exists "config_c6_update_own" on public.config_c6;
create policy "config_c6_update_own"
  on public.config_c6 for update
  using (auth.uid() = user_id);

drop policy if exists "config_c6_delete_own" on public.config_c6;
create policy "config_c6_delete_own"
  on public.config_c6 for delete
  using (auth.uid() = user_id);

comment on table public.config_c6 is
  'Credenciais API Boleto C6 Bank (mTLS .crt/.key). Vinculado a um emitente NFS-e.';

-- Expandir tipo_emissao para incluir c6 (recria check).
alter table public.boletos_parcela_venda drop constraint if exists boletos_parcela_venda_tipo_emissao_check;
alter table public.boletos_parcela_venda
  add constraint boletos_parcela_venda_tipo_emissao_check
  check (tipo_emissao in ('informativo', 'sicoob', 'c6'));

alter table public.boletos_parcela_venda
  add column if not exists emitente_id uuid references public.nfse_emitente (id) on delete set null,
  add column if not exists c6_boleto_id text,
  add column if not exists c6_external_id text;

create index if not exists idx_boletos_parc_emitente on public.boletos_parcela_venda (emitente_id)
  where emitente_id is not null;
create index if not exists idx_boletos_parc_c6_id on public.boletos_parcela_venda (c6_boleto_id)
  where c6_boleto_id is not null;

comment on column public.boletos_parcela_venda.tipo_emissao is
  'informativo = carnê interno; sicoob = API Sicoob V3; c6 = API C6 Bank.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('boletos_c6', 'boletos_c6', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'c6_certs',
  'c6_certs',
  false,
  1048576,
  array['application/x-x509-ca-cert', 'application/pkix-cert', 'application/octet-stream', 'text/plain', '*/*']
)
on conflict (id) do nothing;

-- Storage: usuário autenticado só acessa a própria pasta (user_id/).
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
  using (bucket_id = 'c6_certs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "c6_certs_delete_own" on storage.objects;
create policy "c6_certs_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'c6_certs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "boletos_c6_select_own" on storage.objects;
create policy "boletos_c6_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'boletos_c6' and (storage.foldername(name))[1] = auth.uid()::text);
