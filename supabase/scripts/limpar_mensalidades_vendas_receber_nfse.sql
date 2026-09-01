-- =============================================================================
-- Limpar: mensalidades, vendas, contas a receber (boletos) e NFS-e
--
-- MANTÉM:
--   • clientes, contatos_cliente, justificativas
--   • login (auth.users)
--   • configs: NFS-e emitente, C6, Sicoob, perfil de cobrança, certificados
--   • catálogos: segmento_cliente, tipos_ramo, formas_pagamento
--   • notificações
--
-- APAGA:
--   • mensalidades + pagamentos_mensalidades
--   • vendas + parcelas + pagamentos + log financeiro
--   • boletos_parcela_venda (A receber) + histórico Sicoob/C6
--   • nota_fiscal + itens + pagamentos da nota
--
-- Execute no SQL Editor do Supabase (postgres / service role).
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
  public.vendas
restart identity cascade;

commit;

-- Conferência (deve ser 0 nas apagadas; clientes permanecem)
select 'clientes (mantidos)' as tabela, count(*)::bigint as registros from public.clientes
union all select 'mensalidades', count(*) from public.mensalidades
union all select 'vendas', count(*) from public.vendas
union all select 'boletos_parcela_venda (a receber)', count(*) from public.boletos_parcela_venda
union all select 'nota_fiscal (nfs-e)', count(*) from public.nota_fiscal
union all select 'nfse_emitente (mantido)', count(*) from public.nfse_emitente
union all select 'config_c6 (mantido)', count(*) from public.config_c6
union all select 'perfil_cobranca (mantido)', count(*) from public.perfil_cobranca;

-- ---------------------------------------------------------------------------
-- OPCIONAL: limpar só um usuário
-- ---------------------------------------------------------------------------
/*
begin;
do $$
declare
  v_user_id uuid := '00000000-0000-0000-0000-000000000000';
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
end $$;
commit;
*/
