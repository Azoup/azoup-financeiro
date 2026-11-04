-- Desconto concedido na baixa manual (contas a receber / mensalidades / parcelas).
-- Quitação: valor_pago + desconto >= valor.

alter table public.mensalidades
  add column if not exists desconto numeric(14, 2) not null default 0;

alter table public.parcelas_venda
  add column if not exists desconto numeric(14, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mensalidades_desconto_nonneg'
  ) then
    alter table public.mensalidades
      add constraint mensalidades_desconto_nonneg check (desconto >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'parcelas_venda_desconto_nonneg'
  ) then
    alter table public.parcelas_venda
      add constraint parcelas_venda_desconto_nonneg check (desconto >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'mensalidades_pago_mais_desconto_lte_valor'
  ) then
    alter table public.mensalidades
      add constraint mensalidades_pago_mais_desconto_lte_valor
      check (valor_pago + desconto <= valor);
  end if;
end $$;

comment on column public.mensalidades.desconto is
  'Abatimento acumulado concedido na baixa; quita quando valor_pago + desconto >= valor.';
comment on column public.parcelas_venda.desconto is
  'Abatimento acumulado concedido na baixa; quita quando valor_pago + desconto >= valor.';
