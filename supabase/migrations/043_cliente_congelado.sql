-- Período em que o cliente fica paralisado (pausa de uso): oculto em Gerar mensalidades até a data (inclusive).
-- Após congelado_ate, volta a aparecer e gera notificação de retorno (044_notificacoes).

alter table public.clientes
  add column if not exists congelado_ate date;

comment on column public.clientes.congelado_ate is
  'Último dia da paralisação. Enquanto hoje <= esta data, o cliente não aparece em Gerar mensalidades. Null = não paralisado.';
