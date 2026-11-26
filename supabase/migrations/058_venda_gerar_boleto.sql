-- Opção "Não gerar boleto" na venda — evita recriar carnê automático em A receber.
-- Rode no Supabase → SQL Editor → Run.

alter table public.vendas
  add column if not exists gerar_boleto boolean not null default true;

comment on column public.vendas.gerar_boleto is
  'false = venda criada sem carnê/boleto; não sincronizar automaticamente em Contas a receber.';

-- Backfill a partir do log de criação (detalhe.gerar_boleto = false).
update public.vendas v
set gerar_boleto = false
where exists (
  select 1
  from public.vendas_financeiro_log l
  where l.venda_id = v.id
    and l.tipo = 'venda_criada'
    and coalesce((l.detalhe->>'gerar_boleto')::boolean, true) = false
);
