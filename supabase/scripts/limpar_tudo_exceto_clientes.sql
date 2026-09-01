-- =============================================================================
-- LIMPAR TUDO DO SISTEMA — EXCETO CADASTRO DE CLIENTES
--
-- MANTÉM:
--   • auth.users (login)
--   • clientes
--   • contatos_cliente
--   • justificativas_cancelamento_cliente (histórico ligado ao cliente)
--   • catálogos: tipos_ramo, segmento_cliente, formas_pagamento
--
-- APAGA (operacional + financeiro + fiscal + configs):
--   • mensalidades, vendas, boletos, NFS-e, notificações
--   • perfil de cobrança, emitentes NFS-e, certificados, C6, Sicoob
--
-- NÃO LIMPA Storage (PDFs/XMLs) — veja bloco opcional no final.
--
-- Execute no SQL Editor do Supabase como postgres / service role.
-- REVISE ANTES DE RODAR EM PRODUÇÃO. Operação irreversível.
-- =============================================================================

begin;

truncate table
  public.historico_boleto_sicoob,
  public.nota_fiscal_pagamento,
  public.nota_fiscal_item,
  public.nota_fiscal,
  public.boletos_parcela_venda,
  public.pagamento_parcelas,
  public.pagamentos_mensalidades,
  public.pagamentos_venda,
  public.vendas_financeiro_log,
  public.parcelas_venda,
  public.mensalidades,
  public.vendas,
  public.notificacoes,
  public.perfil_cobranca,
  public.config_c6,
  public.config_sicoob,
  public.empresa_certificado_secreto,
  public.empresa_certificado,
  public.nfe_config,
  public.nfse_emitente,
  public.app_runtime_config
restart identity cascade;

commit;

-- ---------------------------------------------------------------------------
-- Conferência (clientes/contatos devem permanecer; demais = 0)
-- ---------------------------------------------------------------------------
select 'clientes (mantidos)' as tabela, count(*)::bigint as registros from public.clientes
union all select 'contatos_cliente (mantidos)', count(*) from public.contatos_cliente
union all select 'auth.users (mantidos)', count(*) from auth.users
union all select 'mensalidades', count(*) from public.mensalidades
union all select 'vendas', count(*) from public.vendas
union all select 'boletos_parcela_venda', count(*) from public.boletos_parcela_venda
union all select 'nota_fiscal', count(*) from public.nota_fiscal
union all select 'nfse_emitente', count(*) from public.nfse_emitente
union all select 'config_c6', count(*) from public.config_c6
union all select 'config_sicoob', count(*) from public.config_sicoob
union all select 'notificacoes', count(*) from public.notificacoes
union all select 'perfil_cobranca', count(*) from public.perfil_cobranca;

-- ---------------------------------------------------------------------------
-- OPCIONAL A: limpar só um usuário (comente o TRUNCATE acima e use este bloco)
-- ---------------------------------------------------------------------------
/*
begin;
do $$
declare
  v_user_id uuid := '00000000-0000-0000-0000-000000000000'; -- auth.users.id
begin
  delete from public.historico_boleto_sicoob h
  using public.boletos_parcela_venda b
  where h.boleto_id = b.id and b.user_id = v_user_id;

  delete from public.nota_fiscal_pagamento np
  using public.nota_fiscal n
  where np.nota_fiscal_id = n.id and n.user_id = v_user_id;

  delete from public.nota_fiscal_item ni
  using public.nota_fiscal n
  where ni.nota_fiscal_id = n.id and n.user_id = v_user_id;

  delete from public.nota_fiscal where user_id = v_user_id;
  delete from public.boletos_parcela_venda where user_id = v_user_id;

  delete from public.pagamentos_mensalidades pm
  using public.mensalidades m
  where pm.mensalidade_id = m.id and m.user_id = v_user_id;

  delete from public.pagamento_parcelas pp
  using public.pagamentos_venda pv
  join public.vendas v on v.id = pv.venda_id
  where pp.pagamento_id = pv.id and v.user_id = v_user_id;

  delete from public.pagamentos_venda pv
  using public.vendas v
  where pv.venda_id = v.id and v.user_id = v_user_id;

  delete from public.vendas_financeiro_log where user_id = v_user_id;

  delete from public.parcelas_venda p
  using public.vendas v
  where p.venda_id = v.id and v.user_id = v_user_id;

  delete from public.mensalidades where user_id = v_user_id;
  delete from public.vendas where user_id = v_user_id;
  delete from public.notificacoes where user_id = v_user_id;
  delete from public.perfil_cobranca where user_id = v_user_id;
  delete from public.config_c6 where user_id = v_user_id;
  delete from public.config_sicoob where user_id = v_user_id;
  delete from public.empresa_certificado_secreto s
  using public.empresa_certificado c
  where s.certificado_id = c.id and c.user_id = v_user_id;
  delete from public.empresa_certificado where user_id = v_user_id;
  delete from public.nfe_config where user_id = v_user_id;
  delete from public.nfse_emitente where user_id = v_user_id;
end $$;
commit;
*/

-- ---------------------------------------------------------------------------
-- OPCIONAL B: limpar também justificativas de cancelamento dos clientes
-- ---------------------------------------------------------------------------
-- truncate table public.justificativas_cancelamento_cliente restart identity cascade;

-- ---------------------------------------------------------------------------
-- OPCIONAL C: Storage (rodar separado no Dashboard ou via API — não é SQL de tabela)
-- Buckets: boletos_c6, nfe_xmls, nota_fiscal_danfe, c6_certs
-- Mantém clientes-pdfs se quiser preservar PDFs do cadastro.
-- ---------------------------------------------------------------------------
