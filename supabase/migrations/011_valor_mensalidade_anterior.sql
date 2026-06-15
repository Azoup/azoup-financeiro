-- Valor da mensalidade antes do último reajuste (ex.: tela Gerar mensalidade / edição manual)

alter table public.clientes
  add column if not exists valor_mensalidade_anterior numeric(12, 2);

comment on column public.clientes.valor_mensalidade_anterior is
  'Última mensalidade antes do reajuste aplicado (lote ou alteração no cadastro).';
