-- Histórico de justificativas ao marcar cliente como cancelado.

create table if not exists public.justificativas_cancelamento_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
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
      select 1 from public.clientes c
      where c.id = cliente_id and c.user_id = auth.uid()
    )
  );

comment on table public.justificativas_cancelamento_cliente is
  'Motivo informado ao cancelar cliente; exibir o mais recente na ficha.';
