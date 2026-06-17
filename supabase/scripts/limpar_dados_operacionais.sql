-- =============================================================================
-- Limpar dados operacionais (mensalidades, vendas, contas a receber, perfil)
--
-- MANTÉM:
--   • auth.users e demais tabelas do schema auth (login)
--   • clientes, contatos_cliente, justificativas_cancelamento_cliente
--   • catálogos do cadastro: tipos_ramo, segmento_cliente
--   • formas_pagamento (catálogo de vendas; só os registros padrão permanecem)
--   • PDFs no Storage (bucket clientes-pdfs)
--
-- APAGA:
--   • mensalidades e pagamentos_mensalidades
--   • vendas, parcelas, pagamentos e log financeiro
--   • boletos_parcela_venda (carnês / contas a receber)
--   • perfil_cobranca (dados do beneficiário)
--
-- Execute no SQL Editor do Supabase (como postgres / service role).
-- Revise antes de rodar em produção.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Opção A: limpar TUDO (todos os usuários) — padrão
-- ---------------------------------------------------------------------------
truncate table
  public.nota_fiscal_pagamento,
  public.nota_fiscal_item,
  public.nota_fiscal,
  public.pagamento_parcelas,
  public.boletos_parcela_venda,
  public.pagamentos_mensalidades,
  public.pagamentos_venda,
  public.vendas_financeiro_log,
  public.parcelas_venda,
  public.mensalidades,
  public.vendas,
  public.perfil_cobranca
restart identity cascade;

-- ---------------------------------------------------------------------------
-- Opção B: limpar só um usuário (comente o TRUNCATE acima e descomente abaixo)
-- Substitua o UUID pelo auth.users.id desejado.
-- ---------------------------------------------------------------------------
/*
do $$
declare
  v_user_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  delete from public.pagamento_parcelas pp
  using public.pagamentos_venda pv
  join public.vendas v on v.id = pv.venda_id
  where pp.pagamento_id = pv.id and v.user_id = v_user_id;

  delete from public.boletos_parcela_venda where user_id = v_user_id;

  delete from public.pagamentos_mensalidades pm
  using public.mensalidades m
  where pm.mensalidade_id = m.id and m.user_id = v_user_id;

  delete from public.pagamentos_venda pv
  using public.vendas v
  where pv.venda_id = v.id and v.user_id = v_user_id;

  delete from public.vendas_financeiro_log where user_id = v_user_id;

  delete from public.parcelas_venda p
  using public.vendas v
  where p.venda_id = v.id and v.user_id = v_user_id;

  delete from public.mensalidades where user_id = v_user_id;

  delete from public.vendas where user_id = v_user_id;

  delete from public.perfil_cobranca where user_id = v_user_id;
end $$;
*/

commit;

-- Conferência rápida (deve retornar 0 em todas as linhas):
select 'mensalidades' as tabela, count(*)::bigint as registros from public.mensalidades
union all select 'vendas', count(*) from public.vendas
union all select 'boletos_parcela_venda', count(*) from public.boletos_parcela_venda
union all select 'perfil_cobranca', count(*) from public.perfil_cobranca
union all select 'nota_fiscal', count(*) from public.nota_fiscal
union all select 'clientes (mantidos)', count(*) from public.clientes
union all select 'contatos_cliente (mantidos)', count(*) from public.contatos_cliente
union all select 'auth.users (mantidos)', count(*) from auth.users;
