-- Contas a receber (carnês/boletos) — setup completo para vendas e mensalidades.
-- Rode no SQL Editor se carnês não aparecem após criar venda/mensalidade.

create table if not exists public.perfil_cobranca (
  user_id uuid primary key references auth.users (id) on delete cascade,
  razao_social text not null default '',
  documento text not null default '',
  logradouro text not null default '',
  numero text not null default '',
  complemento text not null default '',
  bairro text not null default '',
  cidade text not null default '',
  uf text not null default '',
  cep text not null default '',
  cooperativa_nome text,
  codigo_beneficiario_agencia text,
  telefone_suporte text,
  instrucoes_cobranca text not null default '',
  local_pagamento text not null default 'PAGÁVEL PREFERENCIALMENTE NOS CANAIS DO SEU BANCO',
  mensagem_padrao_pagador text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boletos_parcela_venda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venda_id uuid references public.vendas (id) on delete cascade,
  parcela_id uuid references public.parcelas_venda (id) on delete cascade,
  mensalidade_id uuid references public.mensalidades (id) on delete cascade,
  origem text not null default 'venda',
  numero_parcela int not null,
  total_parcelas_venda int not null,
  beneficiario_razao_social text not null default '',
  beneficiario_documento text not null default '',
  beneficiario_endereco text not null default '',
  beneficiario_bairro text not null default '',
  beneficiario_cidade_uf_cep text not null default '',
  pagador_nome text not null default '',
  pagador_documento text not null default '',
  pagador_endereco text not null default '',
  pagador_cidade_uf_cep text not null default '',
  mensagem_pagador text,
  venda_descricao_resumo text not null default '',
  valor_documento numeric(14, 2) not null,
  data_vencimento date not null,
  data_documento date not null default (current_date),
  nosso_numero text not null default '',
  numero_documento text not null default '',
  local_pagamento text not null default '',
  instrucoes text not null default '',
  cooperativa_rodape text,
  tipo_emissao text not null default 'informativo',
  status_registro text not null default 'informativo',
  linha_digitavel text,
  codigo_barras text,
  nosso_numero_banco text,
  sicoob_seu_numero text,
  pdf_storage_path text,
  pdf_url text,
  mensagem_erro_registro text,
  data_registro timestamptz,
  nota_fiscal_id uuid,
  created_at timestamptz not null default now()
);

alter table public.boletos_parcela_venda
  add column if not exists mensalidade_id uuid references public.mensalidades (id) on delete cascade,
  add column if not exists origem text not null default 'venda',
  add column if not exists tipo_emissao text not null default 'informativo',
  add column if not exists status_registro text not null default 'informativo',
  add column if not exists linha_digitavel text,
  add column if not exists codigo_barras text,
  add column if not exists nosso_numero_banco text,
  add column if not exists sicoob_seu_numero text,
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_url text,
  add column if not exists mensagem_erro_registro text,
  add column if not exists data_registro timestamptz,
  add column if not exists nota_fiscal_id uuid;

alter table public.boletos_parcela_venda
  alter column venda_id drop not null,
  alter column parcela_id drop not null;

update public.boletos_parcela_venda set origem = 'venda' where origem is null;

alter table public.boletos_parcela_venda
  drop constraint if exists boletos_parcela_venda_origem_check;

alter table public.boletos_parcela_venda
  add constraint boletos_parcela_venda_origem_check
  check (origem in ('venda', 'mensalidade'));

alter table public.boletos_parcela_venda
  drop constraint if exists chk_boletos_parc_origem;

alter table public.boletos_parcela_venda
  add constraint chk_boletos_parc_origem check (
    (
      origem = 'venda'
      and venda_id is not null
      and parcela_id is not null
      and mensalidade_id is null
    )
    or (
      origem = 'mensalidade'
      and mensalidade_id is not null
      and venda_id is null
      and parcela_id is null
    )
  );

drop index if exists boletos_parcela_venda_parcela_id_key;
drop index if exists uq_boletos_parc_parcela_id;
create unique index if not exists uq_boletos_parc_parcela_id
  on public.boletos_parcela_venda (parcela_id)
  where parcela_id is not null;

drop index if exists uq_boletos_parc_mensalidade_id;
create unique index if not exists uq_boletos_parc_mensalidade_id
  on public.boletos_parcela_venda (mensalidade_id)
  where mensalidade_id is not null;

create index if not exists idx_boletos_parc_user_venc
  on public.boletos_parcela_venda (user_id, data_vencimento desc);

create index if not exists idx_boletos_parc_venda
  on public.boletos_parcela_venda (venda_id);

create index if not exists idx_boletos_parc_mensalidade
  on public.boletos_parcela_venda (mensalidade_id);

alter table public.perfil_cobranca enable row level security;
alter table public.boletos_parcela_venda enable row level security;

drop policy if exists "perfil_cobranca_select_own" on public.perfil_cobranca;
create policy "perfil_cobranca_select_own"
  on public.perfil_cobranca for select using (auth.uid() = user_id);

drop policy if exists "perfil_cobranca_insert_own" on public.perfil_cobranca;
create policy "perfil_cobranca_insert_own"
  on public.perfil_cobranca for insert with check (auth.uid() = user_id);

drop policy if exists "perfil_cobranca_update_own" on public.perfil_cobranca;
create policy "perfil_cobranca_update_own"
  on public.perfil_cobranca for update using (auth.uid() = user_id);

drop policy if exists "boletos_parc_venda_select_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_select_own"
  on public.boletos_parcela_venda for select using (auth.uid() = user_id);

drop policy if exists "boletos_parc_venda_insert_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_insert_own"
  on public.boletos_parcela_venda for insert with check (auth.uid() = user_id);

drop policy if exists "boletos_parc_venda_update_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_update_own"
  on public.boletos_parcela_venda for update using (auth.uid() = user_id);

drop policy if exists "boletos_parc_venda_delete_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_delete_own"
  on public.boletos_parcela_venda for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
