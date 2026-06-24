-- Clientes importados (planilha/Firebird) costumam ficar sem user_id e não aparecem no app (RLS + filtro por usuário).

create or replace function public.vincular_clientes_orfaos(p_user_id uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.';
  end if;

  update public.clientes
  set user_id = v_uid,
      updated_at = now()
  where user_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.vincular_clientes_orfaos(uuid) from public;
grant execute on function public.vincular_clientes_orfaos(uuid) to authenticated;

comment on function public.vincular_clientes_orfaos(uuid) is
  'Atribui user_id aos clientes órfãos (user_id nulo). Necessário após importação direta no Supabase.';
