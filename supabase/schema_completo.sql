-- =============================================================================
-- SistemaJessica — schema completo (instalação única)
-- Execute no SQL Editor do Supabase (ou psql) em um projeto com auth.users.
--
-- PRÉ-REQUISITO: public.clientes legada (id bigint, nome, nome_fantasia, mensalidade, etc.).
-- O script adiciona só colunas novas; nomes legados são mapeados no app (clientesDbMapping.ts).
--
-- Não inclui: 025_update_clientes_api_ativo.sql (script de dados da planilha).
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Funções compartilhadas
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.preserve_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catálogos (antes de FKs em clientes)
-- ---------------------------------------------------------------------------
create table if not exists public.tipos_ramo (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  created_at timestamptz not null default now()
);

insert into public.tipos_ramo (nome)
values
  ('Confecção'),
  ('Loja'),
  ('Mercado'),
  ('Escritório'),
  ('Distribuidora'),
  ('Diversos')
on conflict (nome) do nothing;

create table if not exists public.segmento_cliente (
  codigo text primary key,
  nome text not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.segmento_cliente (codigo, nome, ordem) values
  ('PF', 'Pessoa física', 10),
  ('PJ', 'Pessoa jurídica', 20),
  ('MEI', 'MEI', 30),
  ('ASSOCIACAO', 'Associação / cooperativa', 40),
  ('DIVERSOS', 'Diversos', 99)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- Clientes (tabela legada existente — só colunas que o app precisa e ainda não existem)
--
-- Mapeamento no app (utils/clientesDbMapping.ts):
--   nome_fantasia → nome_cliente   |   nome → nome_empresa
--   mensalidade → valor_mensalidade   |   estado → uf
--   ativo / data_cancelamento → cancelado   |   tipo_cliente → segmento (fallback)
-- ---------------------------------------------------------------------------
alter table public.clientes add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.clientes add column if not exists documento text;
alter table public.clientes add column if not exists updated_at timestamptz not null default now();
alter table public.clientes add column if not exists data_reajuste date;
alter table public.clientes add column if not exists ultimo_reajuste date;
alter table public.clientes add column if not exists mes_entrada text;
alter table public.clientes add column if not exists observacao text;
alter table public.clientes add column if not exists cep text;
alter table public.clientes add column if not exists logradouro text;
alter table public.clientes add column if not exists numero text;
alter table public.clientes add column if not exists complemento text;
alter table public.clientes add column if not exists bairro text;
alter table public.clientes add column if not exists pdf_path text;
alter table public.clientes add column if not exists cancelado boolean;
alter table public.clientes add column if not exists segmento_cliente_codigo text;
alter table public.clientes add column if not exists valor_mensalidade_anterior double precision;
alter table public.clientes add column if not exists emite_nf boolean not null default false;
alter table public.clientes add column if not exists inscricao_estadual text not null default '';

-- tipo_cliente legado (ex.: 52426) não é código de segmento — só aceita valor do catálogo segmento_cliente
alter table public.clientes drop constraint if exists clientes_segmento_cliente_codigo_fkey;

update public.clientes c
set segmento_cliente_codigo = 'DIVERSOS'
where c.segmento_cliente_codigo is not null
  and trim(c.segmento_cliente_codigo) <> ''
  and not exists (
    select 1 from public.segmento_cliente sc
    where sc.codigo = trim(c.segmento_cliente_codigo)
  );

update public.clientes c
set segmento_cliente_codigo = coalesce(
  (
    select sc.codigo
    from public.segmento_cliente sc
    where sc.codigo = nullif(trim(c.tipo_cliente::text), '')
  ),
  'DIVERSOS'
)
where c.segmento_cliente_codigo is null or trim(c.segmento_cliente_codigo) = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clientes_segmento_cliente_codigo_fkey'
  ) then
    alter table public.clientes
      add constraint clientes_segmento_cliente_codigo_fkey
      foreign key (segmento_cliente_codigo) references public.segmento_cliente (codigo);
  end if;
end $$;

update public.clientes
set cancelado = coalesce(
  cancelado,
  data_cancelamento is not null
  or coalesce(upper(trim(ativo)), 'S') not in ('S', '')
)
where cancelado is null;

update public.clientes
set documento = 'LEG-' || id::text
where documento is null or trim(documento) = '';

alter table public.clientes alter column segmento_cliente_codigo set default 'DIVERSOS';

-- Preenche user_id quando há um único usuário auth
do $$
declare
  uid uuid;
  n_users int;
begin
  select count(*) into n_users from auth.users;
  if n_users = 1 then
    select id into uid from auth.users limit 1;
    update public.clientes set user_id = uid where user_id is null;
  elsif exists (select 1 from public.clientes where user_id is null) then
    raise notice
      'Clientes sem user_id: update public.clientes set user_id = ''<uuid>'' where user_id is null;';
  end if;
end $$;

update public.clientes set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

create or replace function public.alloc_zpf_documento(p_user_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_n bigint;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'acesso negado';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select coalesce(
    max((regexp_match(documento, '^ZPF - ([0-9]+)$'))[1]::bigint),
    0
  ) + 1
  into next_n
  from public.clientes
  where user_id = p_user_id
    and documento ~ '^ZPF - [0-9]+$';

  return 'ZPF - ' || next_n::text;
end;
$$;

grant execute on function public.alloc_zpf_documento(uuid) to authenticated;

create index if not exists idx_clientes_user on public.clientes (user_id);
create index if not exists idx_clientes_nome_fantasia on public.clientes (nome_fantasia);
create index if not exists idx_clientes_nome on public.clientes (nome);
create unique index if not exists ux_clientes_user_documento
  on public.clientes (user_id, documento)
  where user_id is not null and documento is not null and trim(documento) <> '';
create unique index if not exists ux_clientes_user_cnpj
  on public.clientes (user_id, cnpj)
  where user_id is not null and cnpj is not null and trim(cnpj) <> '';

drop trigger if exists tr_clientes_updated on public.clientes;
create trigger tr_clientes_updated
before update on public.clientes
for each row execute procedure public.set_updated_at();

drop trigger if exists tr_clientes_preserve_created_at on public.clientes;
create trigger tr_clientes_preserve_created_at
before update on public.clientes
for each row execute procedure public.preserve_created_at();

alter table public.clientes enable row level security;

drop policy if exists "clientes_select_own" on public.clientes;
create policy "clientes_select_own" on public.clientes for select using (auth.uid() = user_id);

drop policy if exists "clientes_insert_own" on public.clientes;
create policy "clientes_insert_own" on public.clientes for insert with check (auth.uid() = user_id);

drop policy if exists "clientes_update_own" on public.clientes;
create policy "clientes_update_own" on public.clientes for update using (auth.uid() = user_id);

drop policy if exists "clientes_delete_own" on public.clientes;
create policy "clientes_delete_own" on public.clientes for delete using (auth.uid() = user_id);

comment on column public.clientes.nome is 'Razão social (app: nome_empresa).';
comment on column public.clientes.nome_fantasia is 'Nome fantasia (app: nome_cliente).';
comment on column public.clientes.mensalidade is 'Valor mensal (app: valor_mensalidade).';
comment on column public.clientes.estado is 'UF (app: uf).';
comment on column public.clientes.documento is 'Documento interno ZPF (gerado pelo app).';
comment on column public.clientes.cancelado is 'Espelho do status; sincronizado com ativo/data_cancelamento.';

-- ---------------------------------------------------------------------------
-- Contatos do cliente
-- ---------------------------------------------------------------------------
create table if not exists public.contatos_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id bigint not null references public.clientes (id) on delete cascade,
  nome_contato text not null,
  tipo_contato text not null check (tipo_contato in ('email', 'whatsapp')),
  valor_contato text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_contatos_cliente on public.contatos_cliente (cliente_id);

update public.contatos_cliente set created_at = coalesce(created_at, now()) where created_at is null;

drop trigger if exists tr_contatos_preserve_created_at on public.contatos_cliente;
create trigger tr_contatos_preserve_created_at
before update on public.contatos_cliente
for each row execute procedure public.preserve_created_at();

alter table public.contatos_cliente enable row level security;

drop policy if exists "contatos_all_own_cliente" on public.contatos_cliente;
create policy "contatos_all_own_cliente"
  on public.contatos_cliente for all
  using (
    exists (select 1 from public.clientes c where c.id = contatos_cliente.cliente_id and c.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.clientes c where c.id = contatos_cliente.cliente_id and c.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Segmento cliente — RLS
-- ---------------------------------------------------------------------------
alter table public.tipos_ramo enable row level security;
alter table public.segmento_cliente enable row level security;

update public.tipos_ramo set created_at = coalesce(created_at, now()) where created_at is null;

drop trigger if exists tr_tipos_ramo_preserve_created_at on public.tipos_ramo;
create trigger tr_tipos_ramo_preserve_created_at
before update on public.tipos_ramo
for each row execute procedure public.preserve_created_at();

drop policy if exists "tipos_ramo_read" on public.tipos_ramo;
create policy "tipos_ramo_read" on public.tipos_ramo for select to authenticated using (true);

drop policy if exists "tipos_ramo_insert" on public.tipos_ramo;
create policy "tipos_ramo_insert" on public.tipos_ramo for insert to authenticated with check (true);

drop policy if exists "segmento_cliente_select_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_select_authenticated"
  on public.segmento_cliente for select to authenticated using (true);

drop policy if exists "segmento_cliente_insert_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_insert_authenticated"
  on public.segmento_cliente for insert to authenticated with check (true);

drop policy if exists "segmento_cliente_update_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_update_authenticated"
  on public.segmento_cliente for update to authenticated using (true) with check (true);

drop policy if exists "segmento_cliente_delete_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_delete_authenticated"
  on public.segmento_cliente for delete to authenticated using (true);

comment on table public.segmento_cliente is 'Catálogo de segmento; clientes.segmento_cliente_codigo referencia codigo.';

-- ---------------------------------------------------------------------------
-- Justificativas de cancelamento
-- ---------------------------------------------------------------------------
create table if not exists public.justificativas_cancelamento_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id bigint not null references public.clientes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  texto text not null,
  created_at timestamptz not null default now(),
  constraint justificativas_cancelamento_texto_nao_vazio check (length(trim(texto)) > 0)
);

create index if not exists idx_justificativas_cancel_cliente_created
  on public.justificativas_cancelamento_cliente (cliente_id, created_at desc);

alter table public.justificativas_cancelamento_cliente enable row level security;

drop policy if exists "justificativas_cancelamento_select_own" on public.justificativas_cancelamento_cliente;
create policy "justificativas_cancelamento_select_own"
  on public.justificativas_cancelamento_cliente for select
  using (
    exists (
      select 1 from public.clientes c
      where c.id = justificativas_cancelamento_cliente.cliente_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "justificativas_cancelamento_insert_own" on public.justificativas_cancelamento_cliente;
create policy "justificativas_cancelamento_insert_own"
  on public.justificativas_cancelamento_cliente for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.clientes c where c.id = cliente_id and c.user_id = auth.uid()
    )
  );

comment on table public.justificativas_cancelamento_cliente is
  'Motivo informado ao cancelar cliente; exibir o mais recente na ficha.';

-- ---------------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------------
create table if not exists public.formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.formas_pagamento (nome) values
  ('PIX'),
  ('Cartão de Crédito'),
  ('Cartão de Débito'),
  ('Dinheiro'),
  ('Boleto'),
  ('Transferência')
on conflict (nome) do nothing;

create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cliente_id bigint not null references public.clientes (id) on delete restrict,
  descricao text not null,
  itens_descricao jsonb,
  valor_total numeric(14, 2) not null check (valor_total > 0),
  status text not null default 'pendente'
    check (status in ('pendente', 'parcial', 'quitada', 'cancelada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vendas add column if not exists itens_descricao jsonb;

comment on column public.vendas.itens_descricao is
  'JSON array de strings (2+ itens). Null = apenas descricao como texto único.';

create table if not exists public.parcelas_venda (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas (id) on delete cascade,
  grupo_index int not null default 0,
  numero_parcela int not null,
  valor numeric(14, 2) not null check (valor >= 0),
  valor_pago numeric(14, 2) not null default 0 check (valor_pago >= 0),
  data_vencimento date not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'pago', 'parcial', 'atrasado', 'cancelado')),
  forma_pagamento_id uuid not null references public.formas_pagamento (id),
  created_at timestamptz not null default now(),
  unique (venda_id, numero_parcela)
);

create table if not exists public.pagamentos_venda (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  data_pagamento date not null,
  valor_pago numeric(14, 2) not null check (valor_pago > 0),
  observacao text,
  created_at timestamptz not null default now()
);

create table if not exists public.pagamento_parcelas (
  id uuid primary key default gen_random_uuid(),
  pagamento_id uuid not null references public.pagamentos_venda (id) on delete cascade,
  parcela_id uuid not null references public.parcelas_venda (id) on delete cascade,
  valor_aplicado numeric(14, 2) not null check (valor_aplicado > 0),
  unique (pagamento_id, parcela_id)
);

create table if not exists public.vendas_financeiro_log (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null,
  detalhe jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_vendas_user on public.vendas (user_id);
create index if not exists idx_vendas_cliente on public.vendas (cliente_id);
create index if not exists idx_vendas_created on public.vendas (created_at desc);
create index if not exists idx_parcelas_venda on public.parcelas_venda (venda_id);
create index if not exists idx_parcelas_venc on public.parcelas_venda (data_vencimento);
create index if not exists idx_pagamentos_venda on public.pagamentos_venda (venda_id);

drop trigger if exists tr_vendas_updated on public.vendas;
create trigger tr_vendas_updated
before update on public.vendas
for each row execute procedure public.set_updated_at();

alter table public.vendas enable row level security;
alter table public.parcelas_venda enable row level security;
alter table public.pagamentos_venda enable row level security;
alter table public.pagamento_parcelas enable row level security;
alter table public.formas_pagamento enable row level security;
alter table public.vendas_financeiro_log enable row level security;

drop policy if exists "vendas_select_own" on public.vendas;
create policy "vendas_select_own" on public.vendas for select using (auth.uid() = user_id);

drop policy if exists "vendas_insert_own" on public.vendas;
create policy "vendas_insert_own" on public.vendas for insert with check (auth.uid() = user_id);

drop policy if exists "vendas_update_own" on public.vendas;
create policy "vendas_update_own" on public.vendas for update using (auth.uid() = user_id);

drop policy if exists "vendas_delete_own" on public.vendas;
create policy "vendas_delete_own" on public.vendas for delete using (auth.uid() = user_id);

drop policy if exists "parcelas_venda_all_own" on public.parcelas_venda;
create policy "parcelas_venda_all_own"
  on public.parcelas_venda for all
  using (exists (select 1 from public.vendas v where v.id = parcelas_venda.venda_id and v.user_id = auth.uid()))
  with check (exists (select 1 from public.vendas v where v.id = parcelas_venda.venda_id and v.user_id = auth.uid()));

drop policy if exists "pagamentos_venda_all_own" on public.pagamentos_venda;
create policy "pagamentos_venda_all_own"
  on public.pagamentos_venda for all
  using (exists (select 1 from public.vendas v where v.id = pagamentos_venda.venda_id and v.user_id = auth.uid()))
  with check (exists (select 1 from public.vendas v where v.id = pagamentos_venda.venda_id and v.user_id = auth.uid()));

drop policy if exists "pagamento_parcelas_all_own" on public.pagamento_parcelas;
create policy "pagamento_parcelas_all_own"
  on public.pagamento_parcelas for all
  using (
    exists (
      select 1 from public.pagamentos_venda p
      join public.vendas v on v.id = p.venda_id
      where p.id = pagamento_parcelas.pagamento_id and v.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.pagamentos_venda p
      join public.vendas v on v.id = p.venda_id
      where p.id = pagamento_parcelas.pagamento_id and v.user_id = auth.uid()
    )
  );

drop policy if exists "formas_pagamento_select" on public.formas_pagamento;
create policy "formas_pagamento_select"
  on public.formas_pagamento for select to authenticated using (ativo = true);

drop policy if exists "vendas_financeiro_log_select_own" on public.vendas_financeiro_log;
create policy "vendas_financeiro_log_select_own"
  on public.vendas_financeiro_log for select
  using (exists (select 1 from public.vendas v where v.id = vendas_financeiro_log.venda_id and v.user_id = auth.uid()));

drop policy if exists "vendas_financeiro_log_insert_own" on public.vendas_financeiro_log;
create policy "vendas_financeiro_log_insert_own"
  on public.vendas_financeiro_log for insert with check (auth.uid() = user_id);

comment on table public.vendas is 'Vendas por usuário; parcelas e pagamentos vinculados.';

-- ---------------------------------------------------------------------------
-- Mensalidades geradas
-- ---------------------------------------------------------------------------
create table if not exists public.mensalidades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cliente_id bigint not null references public.clientes (id) on delete restrict,
  valor numeric(14, 2) not null check (valor > 0),
  valor_pago numeric(14, 2) not null default 0 check (valor_pago >= 0),
  data_vencimento date not null,
  competencia text,
  status text not null default 'pendente'
    check (status in ('pendente', 'parcial', 'pago', 'atrasado', 'cancelado')),
  data_geracao timestamptz not null default now(),
  observacao text,
  data_pagamento date,
  forma_pagamento text,
  observacao_pagamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valor_pago <= valor)
);

create table if not exists public.pagamentos_mensalidades (
  id uuid primary key default gen_random_uuid(),
  mensalidade_id uuid not null references public.mensalidades (id) on delete cascade,
  valor_pago numeric(14, 2) not null check (valor_pago > 0),
  data_pagamento date not null,
  forma_pagamento text not null,
  observacao text,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_mensalidades_user on public.mensalidades (user_id);
create index if not exists idx_mensalidades_cliente on public.mensalidades (cliente_id);
create index if not exists idx_mensalidades_venc on public.mensalidades (data_vencimento);
create index if not exists idx_mensalidades_geracao on public.mensalidades (data_geracao desc);
create index if not exists idx_pagamentos_mensalidades_mensalidade on public.pagamentos_mensalidades (mensalidade_id);

drop trigger if exists tr_mensalidades_updated on public.mensalidades;
create trigger tr_mensalidades_updated
before update on public.mensalidades
for each row execute procedure public.set_updated_at();

alter table public.mensalidades enable row level security;
alter table public.pagamentos_mensalidades enable row level security;

drop policy if exists "mensalidades_select_own" on public.mensalidades;
create policy "mensalidades_select_own" on public.mensalidades for select using (auth.uid() = user_id);

drop policy if exists "mensalidades_insert_own" on public.mensalidades;
create policy "mensalidades_insert_own" on public.mensalidades for insert with check (auth.uid() = user_id);

drop policy if exists "mensalidades_update_own" on public.mensalidades;
create policy "mensalidades_update_own" on public.mensalidades for update using (auth.uid() = user_id);

drop policy if exists "mensalidades_delete_own" on public.mensalidades;
create policy "mensalidades_delete_own" on public.mensalidades for delete using (auth.uid() = user_id);

drop policy if exists "pagamentos_mensalidades_all_own" on public.pagamentos_mensalidades;
create policy "pagamentos_mensalidades_all_own"
  on public.pagamentos_mensalidades for all
  using (
    exists (
      select 1 from public.mensalidades m
      where m.id = pagamentos_mensalidades.mensalidade_id and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.mensalidades m
      where m.id = pagamentos_mensalidades.mensalidade_id and m.user_id = auth.uid()
    )
    and auth.uid() = usuario_id
  );

comment on table public.mensalidades is 'Gerações de mensalidade por cliente (valor, vencimento, status).';
comment on table public.pagamentos_mensalidades is 'Histórico de recebimentos por mensalidade gerada.';

-- ---------------------------------------------------------------------------
-- Contas a receber (carnês)
-- ---------------------------------------------------------------------------
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
create policy "perfil_cobranca_select_own" on public.perfil_cobranca for select using (auth.uid() = user_id);

drop policy if exists "perfil_cobranca_insert_own" on public.perfil_cobranca;
create policy "perfil_cobranca_insert_own" on public.perfil_cobranca for insert with check (auth.uid() = user_id);

drop policy if exists "perfil_cobranca_update_own" on public.perfil_cobranca;
create policy "perfil_cobranca_update_own" on public.perfil_cobranca for update using (auth.uid() = user_id);

comment on table public.perfil_cobranca is 'Dados do beneficiário usados nos carnês gerados.';

create table if not exists public.boletos_parcela_venda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  origem text not null default 'venda' check (origem in ('venda', 'mensalidade')),
  venda_id uuid references public.vendas (id) on delete cascade,
  parcela_id uuid references public.parcelas_venda (id) on delete cascade,
  mensalidade_id uuid references public.mensalidades (id) on delete cascade,
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
  constraint chk_boletos_parc_origem check (
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
  )
);

create unique index if not exists uq_boletos_parc_parcela_id
  on public.boletos_parcela_venda (parcela_id)
  where parcela_id is not null;

create unique index if not exists uq_boletos_parc_mensalidade_id
  on public.boletos_parcela_venda (mensalidade_id)
  where mensalidade_id is not null;

create index if not exists idx_boletos_parc_user_venc on public.boletos_parcela_venda (user_id, data_vencimento desc);
create index if not exists idx_boletos_parc_venda on public.boletos_parcela_venda (venda_id);
create index if not exists idx_boletos_parc_mensalidade on public.boletos_parcela_venda (mensalidade_id);

alter table public.boletos_parcela_venda enable row level security;

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

comment on table public.boletos_parcela_venda is
  'Carnê/boleto informativo por parcela ou mensalidade; snapshot na emissão.';
comment on column public.boletos_parcela_venda.mensalidade_id is
  'Quando preenchido, carnê vinculado à mensalidade gerada (origem mensalidade).';

-- ---------------------------------------------------------------------------
-- NFS-e (notas fiscais de serviço)
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
  inscricao_municipal text not null default '',
  codigo_tributacao_nacional text not null default '010701',
  codigo_nbs text not null default '106043000',
  op_simp_nac smallint not null default 1 check (op_simp_nac in (1, 2, 3)),
  reg_esp_trib smallint not null default 0 check (reg_esp_trib between 0 and 9),
  trib_issqn smallint not null default 1 check (trib_issqn in (1, 2, 3, 4)),
  tp_ret_issqn smallint not null default 1 check (tp_ret_issqn in (1, 2, 3)),
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

drop trigger if exists tr_nfe_config_updated on public.nfe_config;
create trigger tr_nfe_config_updated
before update on public.nfe_config
for each row execute procedure public.set_updated_at();

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

comment on table public.empresa_certificado_secreto is
  'Senha do certificado A1 criptografada. RLS ativo sem policies — só service_role (API NFS-e) acessa.';

create table if not exists public.nota_fiscal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mensalidade_id uuid references public.mensalidades (id) on delete set null,
  cliente_id bigint not null references public.clientes (id) on delete restrict,
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
  motivo_cancelamento text,
  data_cancelamento timestamptz,
  competencia text,
  tipo_documento text not null default 'nfse' check (tipo_documento in ('nfse', 'nfe')),
  codigo_verificacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, serie, numero)
);

alter table public.nota_fiscal
  add column if not exists motivo_cancelamento text,
  add column if not exists data_cancelamento timestamptz,
  add column if not exists tipo_documento text not null default 'nfse',
  add column if not exists codigo_verificacao text;

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

alter table public.nfe_config enable row level security;
alter table public.empresa_certificado enable row level security;
alter table public.empresa_certificado_secreto enable row level security;
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

comment on table public.nota_fiscal is 'NFS-e de serviço vinculada a mensalidade; emissão via API /api/nfe/emitir.';
comment on table public.nfe_config is 'Parâmetros do prestador e do serviço (NFS-e, homologação).';
comment on column public.nfe_config.codigo_tributacao_nacional is 'cTribNac — código LC 116 (6 dígitos).';
comment on column public.nfe_config.codigo_nbs is 'Código NBS do serviço.';
comment on column public.nfe_config.inscricao_municipal is 'Inscrição municipal do prestador.';
comment on column public.nota_fiscal.tipo_documento is 'nfse = NFS-e; nfe = NF-e legado.';
comment on column public.nota_fiscal.motivo_cancelamento is 'Justificativa do cancelamento (mín. 15 caracteres).';

-- ---------------------------------------------------------------------------
-- Storage (PDFs clientes, certificados, XMLs, DANFE)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('clientes-pdfs', 'clientes-pdfs', false),
  ('empresa_certificados', 'empresa_certificados', false),
  ('nfe_xmls', 'nfe_xmls', false),
  ('nota_fiscal_danfe', 'nota_fiscal_danfe', true)
on conflict (id) do nothing;

drop policy if exists "clientes_pdfs_select_own" on storage.objects;
create policy "clientes_pdfs_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'clientes-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "clientes_pdfs_insert_own" on storage.objects;
create policy "clientes_pdfs_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'clientes-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "clientes_pdfs_update_own" on storage.objects;
create policy "clientes_pdfs_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'clientes-pdfs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'clientes-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "clientes_pdfs_delete_own" on storage.objects;
create policy "clientes_pdfs_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'clientes-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

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
