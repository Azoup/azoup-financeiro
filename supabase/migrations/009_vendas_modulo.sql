-- Módulo de Vendas: formas de pagamento, vendas, parcelas, pagamentos e log financeiro

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
  cliente_id uuid not null references public.clientes (id) on delete restrict,
  descricao text not null,
  valor_total numeric(14, 2) not null check (valor_total > 0),
  status text not null default 'pendente'
    check (status in ('pendente', 'parcial', 'quitada', 'cancelada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
create policy "vendas_select_own"
  on public.vendas for select
  using (auth.uid() = user_id);

drop policy if exists "vendas_insert_own" on public.vendas;
create policy "vendas_insert_own"
  on public.vendas for insert
  with check (auth.uid() = user_id);

drop policy if exists "vendas_update_own" on public.vendas;
create policy "vendas_update_own"
  on public.vendas for update
  using (auth.uid() = user_id);

drop policy if exists "vendas_delete_own" on public.vendas;
create policy "vendas_delete_own"
  on public.vendas for delete
  using (auth.uid() = user_id);

drop policy if exists "parcelas_venda_all_own" on public.parcelas_venda;
create policy "parcelas_venda_all_own"
  on public.parcelas_venda for all
  using (
    exists (select 1 from public.vendas v where v.id = parcelas_venda.venda_id and v.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.vendas v where v.id = parcelas_venda.venda_id and v.user_id = auth.uid())
  );

drop policy if exists "pagamentos_venda_all_own" on public.pagamentos_venda;
create policy "pagamentos_venda_all_own"
  on public.pagamentos_venda for all
  using (
    exists (select 1 from public.vendas v where v.id = pagamentos_venda.venda_id and v.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.vendas v where v.id = pagamentos_venda.venda_id and v.user_id = auth.uid())
  );

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
  on public.formas_pagamento for select
  to authenticated
  using (ativo = true);

drop policy if exists "vendas_financeiro_log_select_own" on public.vendas_financeiro_log;
create policy "vendas_financeiro_log_select_own"
  on public.vendas_financeiro_log for select
  using (
    exists (select 1 from public.vendas v where v.id = vendas_financeiro_log.venda_id and v.user_id = auth.uid())
  );

drop policy if exists "vendas_financeiro_log_insert_own" on public.vendas_financeiro_log;
create policy "vendas_financeiro_log_insert_own"
  on public.vendas_financeiro_log for insert
  with check (auth.uid() = user_id);

comment on table public.vendas is 'Vendas por usuário; parcelas e pagamentos vinculados.';
comment on table public.parcelas_venda is 'Parcelas geradas por venda; status atrasado pode ser exibido na UI por vencimento.';
