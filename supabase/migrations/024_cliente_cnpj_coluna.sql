-- CNPJ do cliente em coluna própria (independente do documento interno ZPF).

alter table public.clientes
  add column if not exists cnpj text not null default '';

comment on column public.clientes.cnpj is 'CNPJ do cliente (PJ). Independente do documento interno (ex.: ZPF - N).';

-- Copia CNPJ que estava salvo em documento para a nova coluna.
update public.clientes c
set cnpj = trim(c.documento)
where c.cnpj = ''
  and length(regexp_replace(trim(c.documento), '[^0-9]', '', 'g')) = 14
  and trim(c.documento) !~ '^ZPF - [0-9]+$';

-- Clientes cujo documento era só CNPJ passam a ter documento interno ZPF (por usuário, ordem de cadastro).
do $$
declare
  r record;
  next_n bigint;
  new_doc text;
begin
  for r in
    select c.id, c.user_id
    from public.clientes c
    where c.cnpj <> ''
      and regexp_replace(trim(c.documento), '[^0-9]', '', 'g') = regexp_replace(trim(c.cnpj), '[^0-9]', '', 'g')
      and trim(c.documento) !~ '^ZPF - [0-9]+$'
    order by c.user_id, c.created_at
  loop
    select coalesce(
      max((regexp_match(documento, '^ZPF - ([0-9]+)$'))[1]::bigint),
      0
    ) + 1
    into next_n
    from public.clientes
    where user_id = r.user_id
      and documento ~ '^ZPF - [0-9]+$';

    new_doc := 'ZPF - ' || next_n::text;
    update public.clientes set documento = new_doc where id = r.id;
  end loop;
end $$;

create unique index if not exists ux_clientes_user_cnpj
  on public.clientes (user_id, cnpj)
  where cnpj <> '';
