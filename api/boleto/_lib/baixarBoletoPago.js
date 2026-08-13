const {
  consultarBoletoSicoobApi,
  cleanupCert,
  isBoletoLiquidado,
  extractDataPagamento,
  extractValorPago,
} = require('./sicoobClient');
const { loadSicoobCredentials } = require('./sicoobCredentials');
const {
  cleanupTemp,
  consultarBoletoC6Api,
  consultarPixC6Api,
  extractC6DataPagamento,
  extractC6ValorPago,
  isC6BoletoLiquidado,
} = require('./c6Client');
const { loadC6CredentialsForBoleto } = require('./c6Credentials');

function reaisParaCentavos(n) {
  return Math.round(Number(n) * 100);
}

function centavosParaReais(c) {
  return c / 100;
}

function nextParcelaStatus(valor, valorPago) {
  const vc = reaisParaCentavos(valor);
  const pc = reaisParaCentavos(valorPago);
  if (pc <= 0) return 'pendente';
  if (pc >= vc) return 'pago';
  return 'parcial';
}

function nextMensalidadeStatus(valor, valorPago) {
  return nextParcelaStatus(valor, valorPago);
}

function formaPagamentoBanco(origemLabel) {
  const u = String(origemLabel).toUpperCase();
  if (u.includes('PIX')) return 'Pix C6';
  if (u.includes('C6')) return 'Boleto C6';
  return 'Boleto Sicoob';
}

async function atualizarStatusVenda(admin, vendaId, userId) {
  const { data: ps } = await admin.from('parcelas_venda').select('valor, valor_pago, status').eq('venda_id', vendaId);
  const rows = ps ?? [];
  if (!rows.length) return;
  const allPaid = rows.every((r) => reaisParaCentavos(r.valor_pago) >= reaisParaCentavos(r.valor));
  const anyPaid = rows.some((r) => reaisParaCentavos(r.valor_pago) > 0);
  const allCancelled = rows.every((r) => r.status === 'cancelado');
  let status = 'pendente';
  if (allCancelled) status = 'cancelada';
  else if (allPaid) status = 'quitada';
  else if (anyPaid) status = 'parcial';
  await admin.from('vendas').update({ status }).eq('id', vendaId).eq('user_id', userId);
}

async function jaQuitadoNoSistema(admin, boleto) {
  if (boleto.mensalidade_id) {
    const { data } = await admin.from('mensalidades').select('valor, valor_pago, status').eq('id', boleto.mensalidade_id).maybeSingle();
    if (!data) return false;
    return data.status === 'pago' || reaisParaCentavos(data.valor_pago) >= reaisParaCentavos(data.valor);
  }
  if (boleto.parcela_id) {
    const { data } = await admin.from('parcelas_venda').select('valor, valor_pago, status').eq('id', boleto.parcela_id).maybeSingle();
    if (!data) return false;
    return data.status === 'pago' || reaisParaCentavos(data.valor_pago) >= reaisParaCentavos(data.valor);
  }
  return false;
}

async function registrarBaixaMensalidade(admin, userId, boleto, { dataPagamento, valorPago, origem, payload }) {
  const { data: mens, error } = await admin.from('mensalidades').select('*').eq('id', boleto.mensalidade_id).eq('user_id', userId).single();
  if (error || !mens) throw new Error('Mensalidade não encontrada para baixa automática.');

  const forma = formaPagamentoBanco(origem);
  const valorCent = reaisParaCentavos(mens.valor);
  const pagoCent = reaisParaCentavos(mens.valor_pago);
  if (pagoCent >= valorCent) {
    await admin.from('boletos_parcela_venda').update({ status_registro: 'pago', data_liquidacao_sicoob: dataPagamento }).eq('id', boleto.id);
    return { baixado: false, motivo: 'mensalidade_ja_quitada' };
  }

  const aplicar = Math.min(valorCent - pagoCent, reaisParaCentavos(valorPago));
  const valorAplicarReais = centavosParaReais(aplicar);

  const { error: payErr } = await admin.from('pagamentos_mensalidades').insert({
    mensalidade_id: mens.id,
    valor_pago: valorAplicarReais,
    data_pagamento: dataPagamento,
    forma_pagamento: forma,
    observacao: `Baixa automática ${forma} (${origem})`,
    usuario_id: userId,
  });
  if (payErr) throw new Error(payErr.message);

  const novoPago = centavosParaReais(pagoCent + aplicar);
  const status = nextMensalidadeStatus(mens.valor, novoPago);

  await admin.from('mensalidades').update({
    valor_pago: novoPago,
    data_pagamento: dataPagamento,
    forma_pagamento: forma,
    observacao_pagamento: `Baixa automática ${forma} (${origem})`,
    status,
  }).eq('id', mens.id);

  await admin.from('boletos_parcela_venda').update({
    status_registro: 'pago',
    data_liquidacao_sicoob: dataPagamento,
    ultima_consulta_sicoob: new Date().toISOString(),
  }).eq('id', boleto.id);

  await admin.from('historico_boleto_sicoob').insert({
    boleto_id: boleto.id,
    acao: 'BAIXA_AUTOMATICA',
    usuario_id: userId,
    detalhes: `Mensalidade quitada via ${origem} (${forma}).`,
    payload_resposta: payload ?? null,
  });

  return { baixado: true, tipo: 'mensalidade', mensalidadeId: mens.id };
}

async function registrarBaixaVenda(admin, userId, boleto, { dataPagamento, valorPago, origem, payload }) {
  if (!boleto.parcela_id || !boleto.venda_id) {
    throw new Error('Boleto de venda sem parcela vinculada.');
  }

  const forma = formaPagamentoBanco(origem);
  const { data: parcela, error: pErr } = await admin
    .from('parcelas_venda')
    .select('*')
    .eq('id', boleto.parcela_id)
    .eq('venda_id', boleto.venda_id)
    .single();
  if (pErr || !parcela) throw new Error('Parcela não encontrada para baixa automática.');

  const valorCent = reaisParaCentavos(parcela.valor);
  const pagoCent = reaisParaCentavos(parcela.valor_pago);
  if (pagoCent >= valorCent) {
    await admin.from('boletos_parcela_venda').update({ status_registro: 'pago', data_liquidacao_sicoob: dataPagamento }).eq('id', boleto.id);
    return { baixado: false, motivo: 'parcela_ja_quitada' };
  }

  const aplicar = Math.min(valorCent - pagoCent, reaisParaCentavos(valorPago));
  const valorAplicarReais = centavosParaReais(aplicar);

  const { data: payIns, error: payErr } = await admin
    .from('pagamentos_venda')
    .insert({
      venda_id: boleto.venda_id,
      user_id: userId,
      data_pagamento: dataPagamento,
      valor_pago: valorAplicarReais,
      observacao: `Baixa automática ${forma} (${origem})`,
    })
    .select('id')
    .single();
  if (payErr || !payIns) throw new Error(payErr?.message ?? 'Erro ao registrar pagamento da venda.');

  const { error: linkErr } = await admin.from('pagamento_parcelas').insert({
    pagamento_id: payIns.id,
    parcela_id: boleto.parcela_id,
    valor_aplicado: valorAplicarReais,
  });
  if (linkErr) {
    await admin.from('pagamentos_venda').delete().eq('id', payIns.id);
    throw new Error(linkErr.message);
  }

  const novoPago = centavosParaReais(pagoCent + aplicar);
  const status = nextParcelaStatus(parcela.valor, novoPago);
  await admin.from('parcelas_venda').update({ valor_pago: novoPago, status }).eq('id', parcela.id);

  await atualizarStatusVenda(admin, boleto.venda_id, userId);
  await admin.from('vendas_financeiro_log').insert({
    venda_id: boleto.venda_id,
    user_id: userId,
    tipo: 'pagamento_registrado',
    detalhe: {
      pagamento_id: payIns.id,
      valor: valorAplicarReais,
      origem: String(origem).toLowerCase(),
      parcela_id: boleto.parcela_id,
    },
  });

  await admin.from('boletos_parcela_venda').update({
    status_registro: 'pago',
    data_liquidacao_sicoob: dataPagamento,
    ultima_consulta_sicoob: new Date().toISOString(),
  }).eq('id', boleto.id);

  await admin.from('historico_boleto_sicoob').insert({
    boleto_id: boleto.id,
    acao: 'BAIXA_AUTOMATICA',
    usuario_id: userId,
    detalhes: `Parcela de venda quitada via ${origem} (${forma}).`,
    payload_resposta: payload ?? null,
  });

  return { baixado: true, tipo: 'venda', parcelaId: parcela.id };
}

async function aplicarBaixaBoleto(admin, userId, boleto, dadosPagamento) {
  if (boleto.status_registro === 'pago') {
    return { baixado: false, motivo: 'boleto_ja_baixado' };
  }

  const quitado = await jaQuitadoNoSistema(admin, boleto);
  if (quitado) {
    await admin.from('boletos_parcela_venda').update({ status_registro: 'pago' }).eq('id', boleto.id);
    return { baixado: false, motivo: 'titulo_ja_quitado' };
  }

  const ctx = {
    dataPagamento: dadosPagamento.dataPagamento,
    valorPago: dadosPagamento.valorPago ?? boleto.valor_documento,
    origem: dadosPagamento.origem ?? 'SICOOB',
    payload: dadosPagamento.payload ?? null,
  };

  if (boleto.mensalidade_id) {
    return registrarBaixaMensalidade(admin, userId, boleto, ctx);
  }
  return registrarBaixaVenda(admin, userId, boleto, ctx);
}

async function consultarEBaixarBoletoSicoob(admin, userId, boleto, origem = 'POLLING') {
  const creds = await loadSicoobCredentials(admin, userId, boleto.emitente_id);
  if (!creds) return { baixado: false, motivo: 'sicoob_inativo', boletoId: boleto.id };

  try {
    const consulta = await consultarBoletoSicoobApi({
      config: creds.config,
      certPath: creds.certPath,
      senha: creds.senha,
      boleto,
    });

    await admin
      .from('boletos_parcela_venda')
      .update({ ultima_consulta_sicoob: new Date().toISOString() })
      .eq('id', boleto.id);

    if (!consulta.liquidado) {
      return { baixado: false, motivo: 'em_aberto', boletoId: boleto.id, situacao: consulta.resultado?.situacaoBoleto ?? null };
    }

    return aplicarBaixaBoleto(admin, userId, boleto, {
      dataPagamento: consulta.dataPagamento,
      valorPago: consulta.valorPago,
      origem,
      payload: consulta.resultado,
    });
  } finally {
    cleanupCert(creds.certPath);
  }
}

async function consultarEBaixarBoletoC6(admin, userId, boleto, origem = 'POLLING_C6') {
  const creds = await loadC6CredentialsForBoleto(admin, boleto);
  if (!creds) return { baixado: false, motivo: 'c6_inativo', boletoId: boleto.id };

  try {
    if (boleto.pix_txid) {
      try {
        const pix = await consultarPixC6Api({
          config: creds.config,
          certPath: creds.certPath,
          keyPath: creds.keyPath,
          txid: boleto.pix_txid,
          comVencimento: true,
        });
        await admin
          .from('boletos_parcela_venda')
          .update({
            ultima_consulta_sicoob: new Date().toISOString(),
            pix_status: pix.resultado?.status ?? boleto.pix_status,
          })
          .eq('id', boleto.id);
        if (pix.liquidado) {
          const pago = Array.isArray(pix.resultado?.pix) ? pix.resultado.pix[0] : null;
          return aplicarBaixaBoleto(admin, userId, boleto, {
            dataPagamento: String(pago?.horario || new Date().toISOString()).slice(0, 10),
            valorPago: Number(pago?.valor || boleto.valor_documento),
            origem: `${origem}_PIX`,
            payload: pix.resultado,
          });
        }
      } catch (e) {
        console.warn('[c6] consulta pix:', e.message);
      }
    }

    if (!boleto.c6_boleto_id) {
      return { baixado: false, motivo: 'sem_id_c6', boletoId: boleto.id };
    }

    const consulta = await consultarBoletoC6Api({
      config: creds.config,
      certPath: creds.certPath,
      keyPath: creds.keyPath,
      c6BoletoId: boleto.c6_boleto_id,
    });

    await admin
      .from('boletos_parcela_venda')
      .update({ ultima_consulta_sicoob: new Date().toISOString() })
      .eq('id', boleto.id);

    if (!consulta.liquidado) {
      return {
        baixado: false,
        motivo: 'em_aberto',
        boletoId: boleto.id,
        situacao: consulta.resultado?.status ?? null,
      };
    }

    return aplicarBaixaBoleto(admin, userId, boleto, {
      dataPagamento: consulta.dataPagamento,
      valorPago: consulta.valorPago ?? boleto.valor_documento,
      origem,
      payload: consulta.resultado,
    });
  } finally {
    if (!creds.bundled) {
      cleanupTemp(creds.certPath);
      cleanupTemp(creds.keyPath);
    }
  }
}

async function consultarEBaixarBoleto(admin, userId, boletoId, origem = 'POLLING') {
  const { data: boleto, error } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .single();
  if (error || !boleto) throw new Error('Boleto não encontrado.');

  if (boleto.status_registro !== 'registrado') {
    return { baixado: false, motivo: 'nao_elegivel', boletoId };
  }

  if (boleto.tipo_emissao === 'c6') {
    return consultarEBaixarBoletoC6(admin, userId, boleto, origem.includes('C6') ? origem : 'POLLING_C6');
  }
  if (boleto.tipo_emissao === 'sicoob') {
    return consultarEBaixarBoletoSicoob(admin, userId, boleto, origem);
  }
  return { baixado: false, motivo: 'nao_elegivel', boletoId };
}

async function baixarPorWebhookPayload(admin, payload) {
  const nossoNumero = String(payload?.nossoNumero ?? payload?.nosso_numero ?? '').trim();
  const numeroCliente = Number(payload?.numeroCliente ?? payload?.numero_cliente ?? 0);
  const situacao = payload?.situacaoBoleto ?? payload?.situacao ?? '';
  if (!nossoNumero || !numeroCliente) {
    throw new Error('Webhook sem nossoNumero ou numeroCliente.');
  }
  if (!isBoletoLiquidado({ situacaoBoleto: situacao })) {
    return { baixado: false, motivo: 'situacao_nao_liquidada' };
  }

  const { data: configs } = await admin.from('config_sicoob').select('user_id, webhook_token').eq('numero_cliente', numeroCliente).eq('ativo', true);
  const configRows = configs ?? [];
  if (!configRows.length) {
    throw new Error('Nenhuma configuração Sicoob para o convênio informado.');
  }

  const { data: boletos } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('nosso_numero_banco', nossoNumero)
    .eq('tipo_emissao', 'sicoob')
    .in(
      'user_id',
      configRows.map((c) => c.user_id),
    )
    .limit(1);

  const boleto = boletos?.[0];
  if (!boleto) {
    return { baixado: false, motivo: 'boleto_nao_encontrado' };
  }

  const cfg = configRows.find((c) => c.user_id === boleto.user_id);
  if (cfg?.webhook_token && payload._webhookToken && cfg.webhook_token !== payload._webhookToken) {
    throw new Error('Token do webhook inválido.');
  }

  return aplicarBaixaBoleto(admin, boleto.user_id, boleto, {
    dataPagamento: extractDataPagamento(payload?.resultado ?? payload),
    valorPago: extractValorPago(payload?.resultado ?? payload, boleto.valor_documento),
    origem: 'WEBHOOK',
    payload,
  });
}

async function baixarPorWebhookPayloadC6(admin, payload) {
  const c6Id = String(
    payload?.id ??
      payload?.bank_slip_id ??
      payload?.bankSlipId ??
      payload?.boleto_id ??
      payload?.data?.id ??
      '',
  ).trim();
  const externalId = String(
    payload?.external_reference_id ?? payload?.externalReferenceId ?? payload?.data?.external_reference_id ?? '',
  ).trim();

  if (!c6Id && !externalId) {
    throw new Error('Webhook C6 sem id do boleto.');
  }

  const statusObj = payload?.data ?? payload;
  if (!isC6BoletoLiquidado(statusObj) && !isC6BoletoLiquidado(payload)) {
    const paidHint = Number(statusObj?.amount_paid ?? statusObj?.paid_amount ?? 0);
    if (!(paidHint > 0) && !String(payload?.event ?? payload?.type ?? '').toLowerCase().includes('paid')) {
      return { baixado: false, motivo: 'situacao_nao_liquidada' };
    }
  }

  let query = admin.from('boletos_parcela_venda').select('*').eq('tipo_emissao', 'c6');
  if (c6Id) query = query.eq('c6_boleto_id', c6Id);
  else query = query.eq('c6_external_id', externalId);

  const { data: boletos, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  const boleto = boletos?.[0];
  if (!boleto) {
    return { baixado: false, motivo: 'boleto_nao_encontrado' };
  }

  if (payload._webhookToken) {
    const { data: cfg } = await admin
      .from('config_c6')
      .select('webhook_token')
      .eq('user_id', boleto.user_id)
      .eq('ativo', true)
      .maybeSingle();
    if (cfg?.webhook_token && cfg.webhook_token !== payload._webhookToken) {
      throw new Error('Token do webhook C6 inválido.');
    }
  }

  return aplicarBaixaBoleto(admin, boleto.user_id, boleto, {
    dataPagamento: extractC6DataPagamento(statusObj),
    valorPago: extractC6ValorPago(statusObj, boleto.valor_documento),
    origem: 'WEBHOOK_C6',
    payload,
  });
}

async function sincronizarBoletosPendentesUsuario(admin, userId, limit = 30) {
  const { data: boletos, error } = await admin
    .from('boletos_parcela_venda')
    .select('id')
    .eq('user_id', userId)
    .in('tipo_emissao', ['sicoob', 'c6'])
    .eq('status_registro', 'registrado')
    .order('data_vencimento', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const resultados = [];
  for (const row of boletos ?? []) {
    try {
      const r = await consultarEBaixarBoleto(admin, userId, row.id, 'POLLING');
      resultados.push({ boletoId: row.id, ...r });
    } catch (e) {
      resultados.push({ boletoId: row.id, baixado: false, erro: e.message });
    }
  }

  const baixados = resultados.filter((r) => r.baixado).length;
  return { consultados: resultados.length, baixados, resultados };
}

async function sincronizarBoletosPendentesGlobal(admin, limitPorUsuario = 20) {
  const userIds = new Set();
  const { data: sicoobCfgs } = await admin.from('config_sicoob').select('user_id').eq('ativo', true);
  for (const c of sicoobCfgs ?? []) userIds.add(c.user_id);
  const { data: c6Cfgs } = await admin.from('config_c6').select('user_id').eq('ativo', true);
  for (const c of c6Cfgs ?? []) userIds.add(c.user_id);

  let consultados = 0;
  let baixados = 0;
  const erros = [];

  for (const userId of userIds) {
    try {
      const r = await sincronizarBoletosPendentesUsuario(admin, userId, limitPorUsuario);
      consultados += r.consultados;
      baixados += r.baixados;
    } catch (e) {
      erros.push(`${userId}: ${e.message}`);
    }
  }

  return { consultados, baixados, erros };
}

module.exports = {
  aplicarBaixaBoleto,
  baixarPorWebhookPayload,
  baixarPorWebhookPayloadC6,
  consultarEBaixarBoleto,
  sincronizarBoletosPendentesGlobal,
  sincronizarBoletosPendentesUsuario,
};
