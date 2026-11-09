-- Banco onde o valor foi efetivamente recebido (ex.: PIX sem boleto).

alter table public.pagamentos_venda
  add column if not exists banco_recebimento text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pagamentos_venda_banco_recebimento_chk'
  ) then
    alter table public.pagamentos_venda
      add constraint pagamentos_venda_banco_recebimento_chk
      check (banco_recebimento is null or banco_recebimento in ('sicoob', 'c6'));
  end if;
end $$;

comment on column public.pagamentos_venda.banco_recebimento is
  'Banco do recebimento (Sicoob/C6), útil quando a baixa é PIX sem boleto.';
