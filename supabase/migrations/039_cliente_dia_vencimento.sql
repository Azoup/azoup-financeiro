-- Dia do mês de vencimento da mensalidade (1–31).
-- Substitui o uso de data_inicio como "primeiro vencimento" completo.
-- Rode no Supabase → SQL Editor → Run.

alter table public.clientes
  add column if not exists dia_vencimento smallint
  check (dia_vencimento is null or (dia_vencimento >= 1 and dia_vencimento <= 31));

comment on column public.clientes.dia_vencimento is
  'Dia do mês (1–31) para vencimento das mensalidades. Em meses curtos usa o último dia.';

-- Migra clientes que já tinham data_inicio → extrai o dia
update public.clientes
set dia_vencimento = extract(day from data_inicio)::smallint
where data_inicio is not null
  and dia_vencimento is null;
