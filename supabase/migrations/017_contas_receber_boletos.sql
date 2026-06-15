-- Contas a receber: perfil do beneficiário (emitente) e um registro de boleto/carnê por parcela de venda.

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

drop trigger if exists tr_perfil_cobranca_updated on public.perfil_cobranca;
create trigger tr_perfil_cobranca_updated
before update on public.perfil_cobranca
for each row execute procedure public.set_updated_at();

alter table public.perfil_cobranca enable row level security;

drop policy if exists "perfil_cobranca_select_own" on public.perfil_cobranca;
create policy "perfil_cobranca_select_own"
  on public.perfil_cobranca for select
  using (auth.uid() = user_id);

drop policy if exists "perfil_cobranca_insert_own" on public.perfil_cobranca;
create policy "perfil_cobranca_insert_own"
  on public.perfil_cobranca for insert
  with check (auth.uid() = user_id);

drop policy if exists "perfil_cobranca_update_own" on public.perfil_cobranca;
create policy "perfil_cobranca_update_own"
  on public.perfil_cobranca for update
  using (auth.uid() = user_id);

comment on table public.perfil_cobranca is
  'Dados do beneficiário (cedente) usados nos boletos/carnês gerados por parcela de venda.';

create table if not exists public.boletos_parcela_venda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venda_id uuid not null references public.vendas (id) on delete cascade,
  parcela_id uuid not null references public.parcelas_venda (id) on delete cascade,
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

  created_at timestamptz not null default now(),

  unique (parcela_id)
);

create index if not exists idx_boletos_parc_user_venc on public.boletos_parcela_venda (user_id, data_vencimento desc);
create index if not exists idx_boletos_parc_venda on public.boletos_parcela_venda (venda_id);

alter table public.boletos_parcela_venda enable row level security;

drop policy if exists "boletos_parc_venda_select_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_select_own"
  on public.boletos_parcela_venda for select
  using (auth.uid() = user_id);

drop policy if exists "boletos_parc_venda_insert_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_insert_own"
  on public.boletos_parcela_venda for insert
  with check (auth.uid() = user_id);

drop policy if exists "boletos_parc_venda_update_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_update_own"
  on public.boletos_parcela_venda for update
  using (auth.uid() = user_id);

drop policy if exists "boletos_parc_venda_delete_own" on public.boletos_parcela_venda;
create policy "boletos_parc_venda_delete_own"
  on public.boletos_parcela_venda for delete
  using (auth.uid() = user_id);

comment on table public.boletos_parcela_venda is
  'Carnê/boleto informativo por parcela; snapshot na emissão. Não substitui boleto registrado no banco.';
