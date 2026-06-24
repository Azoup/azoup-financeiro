-- Integração Sicoob: configuração por usuário e metadados de boleto registrado.

create table if not exists public.config_sicoob (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ativo boolean not null default false,
  ambiente text not null default 'sandbox' check (ambiente in ('sandbox', 'producao')),
  client_id text not null default '',
  numero_cliente bigint not null default 0,
  numero_conta_corrente bigint not null default 0,
  codigo_modalidade int not null default 1,
  codigo_especie_documento text not null default 'DM',
  identificacao_emissao_boleto int not null default 1,
  identificacao_distribuicao_boleto int not null default 1,
  gerar_pix_boleto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tr_config_sicoob_updated on public.config_sicoob;
create trigger tr_config_sicoob_updated
before update on public.config_sicoob
for each row execute procedure public.set_updated_at();

alter table public.config_sicoob enable row level security;

drop policy if exists "config_sicoob_select_own" on public.config_sicoob;
create policy "config_sicoob_select_own"
  on public.config_sicoob for select
  using (auth.uid() = user_id);

drop policy if exists "config_sicoob_insert_own" on public.config_sicoob;
create policy "config_sicoob_insert_own"
  on public.config_sicoob for insert
  with check (auth.uid() = user_id);

drop policy if exists "config_sicoob_update_own" on public.config_sicoob;
create policy "config_sicoob_update_own"
  on public.config_sicoob for update
  using (auth.uid() = user_id);

comment on table public.config_sicoob is
  'Credenciais e parâmetros da API Cobrança Bancária Sicoob (V3). Certificado A1 reutilizado de empresa_certificado.';

alter table public.boletos_parcela_venda
  add column if not exists tipo_emissao text not null default 'informativo'
    check (tipo_emissao in ('informativo', 'sicoob')),
  add column if not exists status_registro text not null default 'informativo'
    check (status_registro in ('informativo', 'pendente', 'registrado', 'erro', 'baixado', 'pago')),
  add column if not exists linha_digitavel text,
  add column if not exists codigo_barras text,
  add column if not exists nosso_numero_banco text,
  add column if not exists sicoob_seu_numero text,
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_url text,
  add column if not exists mensagem_erro_registro text,
  add column if not exists data_registro timestamptz,
  add column if not exists nota_fiscal_id uuid references public.nota_fiscal (id) on delete set null;

create index if not exists idx_boletos_parc_status_reg on public.boletos_parcela_venda (user_id, status_registro);
create index if not exists idx_boletos_parc_nota_fiscal on public.boletos_parcela_venda (nota_fiscal_id)
  where nota_fiscal_id is not null;

create table if not exists public.historico_boleto_sicoob (
  id bigint generated always as identity primary key,
  boleto_id uuid not null references public.boletos_parcela_venda (id) on delete cascade,
  acao text not null,
  usuario_id uuid references auth.users (id) on delete set null,
  detalhes text,
  payload_resposta jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists idx_hist_boleto_sicoob_boleto on public.historico_boleto_sicoob (boleto_id, criado_em desc);

alter table public.historico_boleto_sicoob enable row level security;

drop policy if exists "hist_boleto_sicoob_select_own" on public.historico_boleto_sicoob;
create policy "hist_boleto_sicoob_select_own"
  on public.historico_boleto_sicoob for select
  using (
    exists (
      select 1 from public.boletos_parcela_venda b
      where b.id = historico_boleto_sicoob.boleto_id and b.user_id = auth.uid()
    )
  );

comment on column public.boletos_parcela_venda.tipo_emissao is
  'informativo = carnê interno; sicoob = registrado na API Cobrança Bancária V3.';

-- Bucket privado para PDFs oficiais do Sicoob (criar também no Storage se necessário).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('boletos_sicoob', 'boletos_sicoob', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
