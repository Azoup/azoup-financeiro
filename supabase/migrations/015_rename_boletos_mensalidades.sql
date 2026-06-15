-- Renomeia boletos → mensalidades e pagamentos_boletos → pagamentos_mensalidades;
-- coluna boleto_id → mensalidade_id (FK para mensalidades.id).

drop policy if exists "pagamentos_boletos_all_own" on public.pagamentos_boletos;
drop policy if exists "boletos_select_own" on public.boletos;
drop policy if exists "boletos_insert_own" on public.boletos;
drop policy if exists "boletos_update_own" on public.boletos;
drop policy if exists "boletos_delete_own" on public.boletos;

drop trigger if exists tr_boletos_updated on public.boletos;

alter table public.boletos rename to mensalidades;
alter table public.pagamentos_boletos rename to pagamentos_mensalidades;

alter table public.pagamentos_mensalidades rename column boleto_id to mensalidade_id;

alter index public.idx_boletos_user rename to idx_mensalidades_user;
alter index public.idx_boletos_cliente rename to idx_mensalidades_cliente;
alter index public.idx_boletos_venc rename to idx_mensalidades_venc;
alter index public.idx_boletos_geracao rename to idx_mensalidades_geracao;
alter index public.idx_pagamentos_boletos_boleto rename to idx_pagamentos_mensalidades_mensalidade;

create trigger tr_mensalidades_updated
before update on public.mensalidades
for each row execute procedure public.set_updated_at();

alter table public.mensalidades enable row level security;
alter table public.pagamentos_mensalidades enable row level security;

create policy "mensalidades_select_own"
  on public.mensalidades for select
  using (auth.uid() = user_id);

create policy "mensalidades_insert_own"
  on public.mensalidades for insert
  with check (auth.uid() = user_id);

create policy "mensalidades_update_own"
  on public.mensalidades for update
  using (auth.uid() = user_id);

create policy "mensalidades_delete_own"
  on public.mensalidades for delete
  using (auth.uid() = user_id);

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

comment on table public.mensalidades is
  'Gerações de mensalidade por cliente (valor, vencimento, status de pagamento).';
comment on table public.pagamentos_mensalidades is
  'Histórico de recebimentos por mensalidade gerada.';
