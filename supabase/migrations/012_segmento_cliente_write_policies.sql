-- Permite cadastro e exclusão de segmentos por usuários autenticados (app interno).

drop policy if exists "segmento_cliente_insert_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_insert_authenticated"
  on public.segmento_cliente for insert
  to authenticated
  with check (true);

drop policy if exists "segmento_cliente_update_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_update_authenticated"
  on public.segmento_cliente for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "segmento_cliente_delete_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_delete_authenticated"
  on public.segmento_cliente for delete
  to authenticated
  using (true);
