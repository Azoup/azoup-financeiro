-- Boletos de mensalidade + histórico de pagamentos (depende de clientes e auth.users)

create table if not exists public.boletos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cliente_id uuid not null references public.clientes (id) on delete restrict,
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

create table if not exists public.pagamentos_boletos (
  id uuid primary key default gen_random_uuid(),
  boleto_id uuid not null references public.boletos (id) on delete cascade,
  valor_pago numeric(14, 2) not null check (valor_pago > 0),
  data_pagamento date not null,
  forma_pagamento text not null,
  observacao text,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_boletos_user on public.boletos (user_id);
create index if not exists idx_boletos_cliente on public.boletos (cliente_id);
create index if not exists idx_boletos_venc on public.boletos (data_vencimento);
create index if not exists idx_boletos_geracao on public.boletos (data_geracao desc);
create index if not exists idx_pagamentos_boletos_boleto on public.pagamentos_boletos (boleto_id);

drop trigger if exists tr_boletos_updated on public.boletos;
create trigger tr_boletos_updated
before update on public.boletos
for each row execute procedure public.set_updated_at();

alter table public.boletos enable row level security;
alter table public.pagamentos_boletos enable row level security;

drop policy if exists "boletos_select_own" on public.boletos;
create policy "boletos_select_own"
  on public.boletos for select
  using (auth.uid() = user_id);

drop policy if exists "boletos_insert_own" on public.boletos;
create policy "boletos_insert_own"
  on public.boletos for insert
  with check (auth.uid() = user_id);

drop policy if exists "boletos_update_own" on public.boletos;
create policy "boletos_update_own"
  on public.boletos for update
  using (auth.uid() = user_id);

drop policy if exists "boletos_delete_own" on public.boletos;
create policy "boletos_delete_own"
  on public.boletos for delete
  using (auth.uid() = user_id);

drop policy if exists "pagamentos_boletos_all_own" on public.pagamentos_boletos;
create policy "pagamentos_boletos_all_own"
  on public.pagamentos_boletos for all
  using (
    exists (select 1 from public.boletos b where b.id = pagamentos_boletos.boleto_id and b.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.boletos b where b.id = pagamentos_boletos.boleto_id and b.user_id = auth.uid())
    and auth.uid() = usuario_id
  );

comment on table public.boletos is 'Boletos de mensalidade por cliente; status atrasado pode ser exibido na UI por vencimento.';
comment on table public.pagamentos_boletos is 'Histórico de recebimentos por boleto.';
