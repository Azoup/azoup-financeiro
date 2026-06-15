-- Renomeia: data do primeiro pagamento → data de início
-- Execute no SQL Editor do Supabase (bancos que já usavam data_primeiro_pagamento).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clientes'
      and column_name = 'data_primeiro_pagamento'
  ) then
    alter table public.clientes
      rename column data_primeiro_pagamento to data_inicio;
  end if;
end $$;

-- Garante a coluna (instalações antigas sem nenhuma das duas):
alter table public.clientes add column if not exists data_inicio date;
