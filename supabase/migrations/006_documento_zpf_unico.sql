-- Documento automático "ZPF - {sequencial}" e unicidade por usuário
-- Execute no SQL Editor do Supabase.

-- Um documento não pode se repetir para o mesmo usuário (conta)
create unique index if not exists ux_clientes_user_documento
  on public.clientes (user_id, documento);

-- Próximo número sequencial para o padrão ZPF - N (por usuário), com trava contra concorrência
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
    max(
      (regexp_match(documento, '^ZPF - ([0-9]+)$'))[1]::bigint
    ),
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

comment on function public.alloc_zpf_documento(uuid) is
  'Retorna próximo documento no formato ZPF - N para o usuário autenticado (sequência por conta).';
