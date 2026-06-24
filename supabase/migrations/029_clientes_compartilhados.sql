-- Clientes compartilhados: qualquer usuário autenticado vê e gerencia todos os registros da tabela.

drop policy if exists "clientes_select_own" on public.clientes;
drop policy if exists "clientes_insert_own" on public.clientes;
drop policy if exists "clientes_update_own" on public.clientes;
drop policy if exists "clientes_delete_own" on public.clientes;

create policy "clientes_select_authenticated"
  on public.clientes for select
  to authenticated
  using (true);

create policy "clientes_insert_authenticated"
  on public.clientes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "clientes_update_authenticated"
  on public.clientes for update
  to authenticated
  using (true)
  with check (true);

create policy "clientes_delete_authenticated"
  on public.clientes for delete
  to authenticated
  using (true);

-- Contatos e justificativas seguem o cliente (sem filtro por dono).

drop policy if exists "contatos_all_own_cliente" on public.contatos_cliente;
create policy "contatos_all_authenticated"
  on public.contatos_cliente for all
  to authenticated
  using (
    exists (select 1 from public.clientes c where c.id = contatos_cliente.cliente_id)
  )
  with check (
    exists (select 1 from public.clientes c where c.id = contatos_cliente.cliente_id)
  );

drop policy if exists "justificativas_cancelamento_select_own" on public.justificativas_cancelamento_cliente;
drop policy if exists "justificativas_cancelamento_insert_own" on public.justificativas_cancelamento_cliente;

create policy "justificativas_cancelamento_select_authenticated"
  on public.justificativas_cancelamento_cliente for select
  to authenticated
  using (
    exists (
      select 1 from public.clientes c
      where c.id = justificativas_cancelamento_cliente.cliente_id
    )
  );

create policy "justificativas_cancelamento_insert_authenticated"
  on public.justificativas_cancelamento_cliente for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.clientes c
      where c.id = justificativas_cancelamento_cliente.cliente_id
    )
  );
