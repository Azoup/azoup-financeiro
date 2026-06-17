-- Módulo NFS-e (serviço) — instalação completa.
-- Rode este script se ainda NÃO rodou a 020. Se já rodou 020/021, também funciona (só adiciona o que faltar).

-- ---------------------------------------------------------------------------
-- Configuração fiscal / NFS-e (por usuário)
-- ---------------------------------------------------------------------------
create table if not exists public.nfe_config (
  user_id uuid primary key references auth.users (id) on delete cascade,
  serie text not null default '1',
  proximo_numero integer not null default 1 check (proximo_numero >= 1),
  ambiente smallint not null default 2 check (ambiente in (1, 2)),
  inscricao_estadual text not null default '',
  regime_tributario smallint not null default 1 check (regime_tributario in (1, 2, 3)),
  codigo_ibge_emitente text not null default '',
  ncm_servico text not null default '00000000',
  cfop_padrao text not null default '5933',
  cst_icms text not null default '102',
  csosn text not null default '102',
  descricao_servico_padrao text not null default 'Serviço de mensalidade',
  natureza_operacao text not null default 'Prestação de serviço',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.nfe_config
  add column if not exists inscricao_municipal text not null default '',
  add column if not exists codigo_tributacao_nacional text not null default '010701',
  add column if not exists codigo_nbs text not null default '106043000',
  add column if not exists op_simp_nac smallint not null default 1,
  add column if not exists reg_esp_trib smallint not null default 0,
  add column if not exists trib_issqn smallint not null default 1,
  add column if not exists tp_ret_issqn smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'nfe_config_op_simp_nac_check'
  ) then
    alter table public.nfe_config
      add constraint nfe_config_op_simp_nac_check check (op_simp_nac in (1, 2, 3));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'nfe_config_reg_esp_trib_check'
  ) then
    alter table public.nfe_config
      add constraint nfe_config_reg_esp_trib_check check (reg_esp_trib between 0 and 9);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'nfe_config_trib_issqn_check'
  ) then
    alter table public.nfe_config
      add constraint nfe_config_trib_issqn_check check (trib_issqn in (1, 2, 3, 4));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'nfe_config_tp_ret_issqn_check'
  ) then
    alter table public.nfe_config
      add constraint nfe_config_tp_ret_issqn_check check (tp_ret_issqn in (1, 2, 3));
  end if;
end $$;

drop trigger if exists tr_nfe_config_updated on public.nfe_config;
create trigger tr_nfe_config_updated
before update on public.nfe_config
for each row execute procedure public.set_updated_at();

-- Certificado A1
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

-- Nota fiscal (NFS-e)
create table if not exists public.nota_fiscal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mensalidade_id uuid references public.mensalidades (id) on delete set null,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  serie text not null,
  numero integer not null check (numero >= 1),
  status text not null default 'rascunho'
    check (status in ('rascunho', 'processando', 'autorizada', 'rejeitada', 'cancelada')),
  status_sefaz text,
  chave_acesso text,
  protocolo_autorizacao text,
  xml_autorizado text,
  danfe_url text,
  danfe_storage_path text,
  valor_total numeric(14, 2) not null check (valor_total > 0),
  data_emissao timestamptz not null default now(),
  natureza_operacao text not null default 'Prestação de serviço',
  ambiente smallint not null default 2 check (ambiente in (1, 2)),
  motivo_rejeicao text,
  competencia text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, serie, numero)
);

alter table public.nota_fiscal
  add column if not exists motivo_cancelamento text,
  add column if not exists data_cancelamento timestamptz,
  add column if not exists tipo_documento text not null default 'nfse',
  add column if not exists codigo_verificacao text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'nota_fiscal_tipo_documento_check'
  ) then
    alter table public.nota_fiscal
      add constraint nota_fiscal_tipo_documento_check check (tipo_documento in ('nfse', 'nfe'));
  end if;
end $$;

create index if not exists idx_nota_fiscal_user_created on public.nota_fiscal (user_id, created_at desc);
create index if not exists idx_nota_fiscal_mensalidade on public.nota_fiscal (mensalidade_id);
create index if not exists idx_nota_fiscal_cliente on public.nota_fiscal (cliente_id);

drop trigger if exists tr_nota_fiscal_updated on public.nota_fiscal;
create trigger tr_nota_fiscal_updated
before update on public.nota_fiscal
for each row execute procedure public.set_updated_at();

create table if not exists public.nota_fiscal_item (
  id uuid primary key default gen_random_uuid(),
  nota_fiscal_id uuid not null references public.nota_fiscal (id) on delete cascade,
  numero_item integer not null default 1,
  descricao text not null,
  ncm text not null,
  cfop text not null,
  unidade text not null default 'UN',
  quantidade numeric(14, 4) not null default 1,
  valor_unitario numeric(14, 4) not null,
  valor_total numeric(14, 2) not null,
  cst_icms text,
  csosn text,
  perc_icms numeric(8, 4) not null default 0,
  cst_pis text not null default '07',
  cst_cofins text not null default '07'
);

create index if not exists idx_nota_fiscal_item_nota on public.nota_fiscal_item (nota_fiscal_id);

create table if not exists public.nota_fiscal_pagamento (
  id uuid primary key default gen_random_uuid(),
  nota_fiscal_id uuid not null references public.nota_fiscal (id) on delete cascade,
  forma_pagamento text not null default '99',
  valor numeric(14, 2) not null
);

-- Storage
insert into storage.buckets (id, name, public)
values
  ('empresa_certificados', 'empresa_certificados', false),
  ('nfe_xmls', 'nfe_xmls', false),
  ('nota_fiscal_danfe', 'nota_fiscal_danfe', true)
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

drop policy if exists "nfe_xml_select_own" on storage.objects;
create policy "nfe_xml_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'nfe_xmls' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "nfe_danfe_public_read" on storage.objects;
create policy "nfe_danfe_public_read"
  on storage.objects for select
  using (bucket_id = 'nota_fiscal_danfe');

drop policy if exists "nfe_danfe_insert_own" on storage.objects;
create policy "nfe_danfe_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'nota_fiscal_danfe' and (storage.foldername(name))[1] = auth.uid()::text);

-- RLS
alter table public.nfe_config enable row level security;
alter table public.empresa_certificado enable row level security;
alter table public.nota_fiscal enable row level security;
alter table public.nota_fiscal_item enable row level security;
alter table public.nota_fiscal_pagamento enable row level security;

drop policy if exists "nfe_config_own" on public.nfe_config;
create policy "nfe_config_own" on public.nfe_config for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "empresa_certificado_own" on public.empresa_certificado;
create policy "empresa_certificado_own" on public.empresa_certificado for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "nota_fiscal_select_own" on public.nota_fiscal;
create policy "nota_fiscal_select_own" on public.nota_fiscal for select using (auth.uid() = user_id);

drop policy if exists "nota_fiscal_insert_own" on public.nota_fiscal;
create policy "nota_fiscal_insert_own" on public.nota_fiscal for insert with check (auth.uid() = user_id);

drop policy if exists "nota_fiscal_update_own" on public.nota_fiscal;
create policy "nota_fiscal_update_own" on public.nota_fiscal for update using (auth.uid() = user_id);

drop policy if exists "nota_fiscal_item_all_own" on public.nota_fiscal_item;
create policy "nota_fiscal_item_all_own" on public.nota_fiscal_item for all
  using (exists (select 1 from public.nota_fiscal n where n.id = nota_fiscal_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.nota_fiscal n where n.id = nota_fiscal_id and n.user_id = auth.uid()));

drop policy if exists "nota_fiscal_pagamento_all_own" on public.nota_fiscal_pagamento;
create policy "nota_fiscal_pagamento_all_own" on public.nota_fiscal_pagamento for all
  using (exists (select 1 from public.nota_fiscal n where n.id = nota_fiscal_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.nota_fiscal n where n.id = nota_fiscal_id and n.user_id = auth.uid()));

update public.nfe_config set ambiente = 2 where ambiente is distinct from 2;

comment on table public.nota_fiscal is 'NFS-e de serviço vinculada a mensalidade; emissão via API /api/nfe/emitir.';
comment on table public.nfe_config is 'Parâmetros do prestador e do serviço (NFS-e, homologação).';
comment on column public.nfe_config.codigo_tributacao_nacional is 'cTribNac — código LC 116 (6 dígitos).';
comment on column public.nfe_config.codigo_nbs is 'Código NBS do serviço.';
comment on column public.nfe_config.inscricao_municipal is 'Inscrição municipal do prestador.';
comment on column public.nota_fiscal.tipo_documento is 'nfse = NFS-e; nfe = NF-e legado.';
comment on column public.nota_fiscal.motivo_cancelamento is 'Justificativa do cancelamento (mín. 15 caracteres).';
