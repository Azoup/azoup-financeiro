const zlib = require('zlib');
const {
  consultarBoletoSicoobApi,
  cleanupCert,
  isBoletoLiquidado,
  extractDataPagamento,
  extractValorPago,
  solicitarMovimentacaoSicoobApi,
  consultarSolicitacaoMovimentacaoSicoobApi,
  baixarArquivoMovimentacaoSicoobApi,
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

async function tituloCanceladoNoSistema(admin, boleto) {
  if (boleto.status_registro === 'baixado') return true;
  if (boleto.mensalidade_id) {
    const { data } = await admin.from('mensalidades').select('status').eq('id', boleto.mensalidade_id).maybeSingle();
    return data?.status === 'cancelado';
  }
  if (boleto.parcela_id) {
    const { data } = await admin.from('parcelas_venda').select('status').eq('id', boleto.parcela_id).maybeSingle();
    return data?.status === 'cancelado';
  }
  return false;
}

async function registrarBaixaMensalidade(admin, userId, boleto, { dataPagamento, valorPago, origem, payload }) {
  const { data: mens, error } = await admin.from('mensalidades').select('*').eq('id', boleto.mensalidade_id).eq('user_id', userId).single();
  if (error || !mens) throw new Error('Mensalidade não encontrada para baixa automática.');

  const forma = formaPagamentoBanco(origem);
  const valorCent = reaisParaCentavos(mens.valor);
  const pagoCent = reaisParaCentavos(mens.valor_pago);
  if (mens.status === 'cancelado') {
    return { baixado: false, motivo: 'mensalidade_cancelada' };
  }
  if (pagoCent >= valorCent) {
    await admin.from('boletos_parcela_venda').update({ status_registro: 'pago', data_liquidacao_sicoob: dataPagamento }).eq('id', boleto.id);
    await marcarTituloPagoSeAberto(admin, boleto, dataPagamento);
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
    await marcarTituloPagoSeAberto(admin, boleto, dataPagamento);
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
  if (boleto.status_registro === 'pago' || boleto.status_registro === 'baixado') {
    return { baixado: false, motivo: 'boleto_ja_baixado' };
  }

  if (await tituloCanceladoNoSistema(admin, boleto)) {
    return { baixado: false, motivo: 'titulo_cancelado' };
  }

  const quitado = await jaQuitadoNoSistema(admin, boleto);
  if (quitado) {
    await admin.from('boletos_parcela_venda').update({
      status_registro: 'pago',
      data_liquidacao_sicoob: dadosPagamento.dataPagamento,
    }).eq('id', boleto.id);
    await marcarTituloPagoSeAberto(admin, boleto, dadosPagamento.dataPagamento);
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
  if (!nossoNumero || !numeroCliente) {
    throw new Error('Webhook sem nossoNumero ou numeroCliente.');
  }
  const fonteWebhook =
    payload?.resultado && typeof payload.resultado === 'object'
      ? { ...payload, ...payload.resultado }
      : payload;
  if (!isBoletoLiquidado(fonteWebhook)) {
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

  let boleto = boletos?.[0];
  if (!boleto) {
    const chave = chaveNossoNumero(nossoNumero);
    const { data: candidatos } = await admin
      .from('boletos_parcela_venda')
      .select('*')
      .eq('tipo_emissao', 'sicoob')
      .in(
        'user_id',
        configRows.map((c) => c.user_id),
      )
      .in('status_registro', ['registrado', 'erro'])
      .limit(1000);
    boleto = (candidatos ?? []).find((row) => chave && chaveNossoNumero(row.nosso_numero_banco) === chave);
  }
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

async function marcarTituloPagoSeAberto(admin, boleto, dataPagamento) {
  const data = String(dataPagamento || '').slice(0, 10) || null;
  const abertos = ['pendente', 'parcial', 'atrasado'];
  if (boleto.mensalidade_id) {
    const { data: mens } = await admin
      .from('mensalidades')
      .select('id, valor, status, data_pagamento')
      .eq('id', boleto.mensalidade_id)
      .maybeSingle();
    if (!mens || !abertos.includes(mens.status)) return;
    await admin
      .from('mensalidades')
      .update({
        status: 'pago',
        valor_pago: mens.valor,
        data_pagamento: mens.data_pagamento || data,
      })
      .eq('id', mens.id);
    return;
  }
  if (boleto.parcela_id) {
    const { data: parcela } = await admin
      .from('parcelas_venda')
      .select('id, valor, status')
      .eq('id', boleto.parcela_id)
      .maybeSingle();
    if (!parcela || !abertos.includes(parcela.status)) return;
    await admin.from('parcelas_venda').update({ status: 'pago', valor_pago: parcela.valor }).eq('id', parcela.id);
  }
}

/** Boleto já pago no banco, mas a mensalidade/parcela ficou em aberto. */
async function reconciliarTitulosPagosPeloBanco(admin, userId) {
  const { data, error } = await admin
    .from('boletos_parcela_venda')
    .select('mensalidade_id, parcela_id, data_liquidacao_sicoob')
    .eq('user_id', userId)
    .eq('status_registro', 'pago')
    .limit(1000);
  if (error || !data?.length) return;

  const abertos = ['pendente', 'parcial', 'atrasado'];
  const dataPorMens = new Map();
  const dataPorParcela = new Map();
  for (const boleto of data) {
    if (boleto.mensalidade_id && !dataPorMens.has(boleto.mensalidade_id)) {
      dataPorMens.set(boleto.mensalidade_id, boleto.data_liquidacao_sicoob);
    }
    if (boleto.parcela_id && !dataPorParcela.has(boleto.parcela_id)) {
      dataPorParcela.set(boleto.parcela_id, boleto.data_liquidacao_sicoob);
    }
  }

  const mensIds = [...dataPorMens.keys()];
  if (mensIds.length) {
    const { data: mens } = await admin
      .from('mensalidades')
      .select('id, valor, status, data_pagamento')
      .in('id', mensIds)
      .in('status', abertos);
    for (const m of mens ?? []) {
      const data = String(dataPorMens.get(m.id) || m.data_pagamento || '').slice(0, 10) || null;
      await admin
        .from('mensalidades')
        .update({ status: 'pago', valor_pago: m.valor, data_pagamento: data })
        .eq('id', m.id);
    }
  }

  const parcelaIds = [...dataPorParcela.keys()];
  if (parcelaIds.length) {
    const { data: parcelas } = await admin
      .from('parcelas_venda')
      .select('id, valor, status')
      .in('id', parcelaIds)
      .in('status', abertos);
    for (const p of parcelas ?? []) {
      await admin.from('parcelas_venda').update({ status: 'pago', valor_pago: p.valor }).eq('id', p.id);
    }
  }
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hojeIsoBrasil() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function somarDiasIso(iso, dias) {
  const [y, m, d] = String(iso).split('-').map((n) => Number(n));
  const data = new Date(Date.UTC(y, m - 1, d));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function janelaLiquidacao(indice) {
  const fim = somarDiasIso(hojeIsoBrasil(), -indice * 2);
  const inicio = somarDiasIso(fim, -1);
  return { dataInicial: inicio, dataFinal: fim };
}

function chaveNossoNumero(valor) {
  const bruto = String(valor ?? '').trim();
  const parte = bruto.includes('-') ? bruto.split('-')[0] : bruto;
  return parte.replace(/\D/g, '').replace(/^0+/, '');
}

function unzipPrimeiroJson(base64) {
  const buf = Buffer.from(String(base64).replace(/\s/g, ''), 'base64');
  const textoDireto = buf.toString('utf8').trim();
  if (textoDireto.startsWith('[') || textoDireto.startsWith('{')) return textoDireto;
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Arquivo de liquidação do Sicoob em formato inesperado.');
  }
  const flags = buf.readUInt16LE(6);
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  let compSize = buf.readUInt32LE(18);
  const dataStart = 30 + nameLen + extraLen;
  if (flags & 0x8 || !compSize) {
    const proximo = buf.indexOf(Buffer.from([0x50, 0x4b]), dataStart + 1);
    compSize = (proximo > dataStart ? proximo : buf.length) - dataStart;
  }
  const compressed = buf.subarray(dataStart, dataStart + compSize);
  const content = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
  if (!content) throw new Error('Não foi possível ler o arquivo de liquidação do Sicoob.');
  return content.toString('utf8');
}

function titulosDaLiquidacao(base64) {
  const texto = unzipPrimeiroJson(base64);
  const json = JSON.parse(texto);
  const lista = Array.isArray(json) ? json : Array.isArray(json?.resultado) ? json.resultado : [];
  return lista.filter((item) => {
    const sigla = String(item?.siglaMovimento ?? '').toUpperCase();
    const tipo = Number(item?.codigoTipoMovimento ?? 0);
    if (sigla.startsWith('BAIX') || tipo === 6) return false;
    return sigla.startsWith('LIQU') || tipo === 5 || Boolean(item?.dataLiquidacao);
  });
}

async function listarSicoobRegistrados(admin, userId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('boletos_parcela_venda')
      .select('*')
      .eq('user_id', userId)
      .eq('tipo_emissao', 'sicoob')
      .eq('status_registro', 'registrado')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function baixarLiquidacoesSicoob(admin, userId, rodada, janelas, deadline) {
  const creds = await loadSicoobCredentials(admin, userId);
  if (!creds) return { baixados: 0, resultados: [] };

  const resultados = [];
  let baixados = 0;
  try {
    const boletos = await listarSicoobRegistrados(admin, userId);
    const porNumero = new Map();
    for (const boleto of boletos) {
      const chave = chaveNossoNumero(boleto.nosso_numero_banco);
      if (chave && !porNumero.has(chave)) porNumero.set(chave, boleto);
    }

    for (let i = 0; i < janelas; i += 1) {
      if (Date.now() > deadline) break;
      const janela = janelaLiquidacao(rodada + i);
      try {
        const codigo = await solicitarMovimentacaoSicoobApi({
          config: creds.config,
          certPath: creds.certPath,
          senha: creds.senha,
          tipoMovimento: 5,
          dataInicial: janela.dataInicial,
          dataFinal: janela.dataFinal,
        });
        let arquivos = [];
        for (let tentativa = 0; tentativa < 4; tentativa += 1) {
          if (tentativa > 0) await esperar(1000);
          const consulta = await consultarSolicitacaoMovimentacaoSicoobApi({
            config: creds.config,
            certPath: creds.certPath,
            senha: creds.senha,
            codigoSolicitacao: codigo,
          });
          if (consulta.pronto) {
            arquivos = consulta.idArquivos;
            break;
          }
        }
        for (const idArquivo of arquivos) {
          if (Date.now() > deadline) break;
          const base64 = await baixarArquivoMovimentacaoSicoobApi({
            config: creds.config,
            certPath: creds.certPath,
            senha: creds.senha,
            codigoSolicitacao: codigo,
            idArquivo,
          });
          for (const titulo of titulosDaLiquidacao(base64)) {
            const boleto = porNumero.get(chaveNossoNumero(titulo.numeroTitulo));
            if (!boleto) continue;
            const dataPagamento = String(titulo.dataLiquidacao || titulo.dataMovimentoLiquidacao || hojeIsoBrasil()).slice(0, 10);
            const valorPago = Number(titulo.valorLiquido ?? titulo.valorTitulo ?? boleto.valor_documento);
            const baixa = await aplicarBaixaBoleto(admin, userId, boleto, {
              dataPagamento,
              valorPago: Number.isFinite(valorPago) && valorPago > 0 ? valorPago : boleto.valor_documento,
              origem: 'LIQUIDACAO_SICOOB',
              payload: titulo,
            });
            porNumero.delete(chaveNossoNumero(titulo.numeroTitulo));
            resultados.push({ boletoId: boleto.id, origem: 'movimentacao', ...baixa });
            if (baixa.baixado) baixados += 1;
          }
        }
      } catch (e) {
        resultados.push({
          boletoId: null,
          origem: 'movimentacao',
          baixado: false,
          erro: e.message,
          periodo: `${janela.dataInicial} a ${janela.dataFinal}`,
        });
        break;
      }
    }
  } finally {
    cleanupCert(creds.certPath);
  }

  return { baixados, resultados };
}

async function listarBoletosParaConsulta(admin, userId, limit, tipo) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const base = () => {
    let query = admin
      .from('boletos_parcela_venda')
      .select('id')
      .eq('user_id', userId)
      .eq('status_registro', 'registrado');
    if (tipo) query = query.eq('tipo_emissao', tipo);
    else query = query.in('tipo_emissao', ['sicoob', 'c6']);
    return query;
  };

  const { data: vencidos, error } = await base()
    .lte('data_vencimento', hoje)
    .order('ultima_consulta_sicoob', { ascending: true, nullsFirst: true })
    .order('data_vencimento', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const escolhidos = vencidos ?? [];
  if (escolhidos.length >= limit) return escolhidos;

  const { data: futuros, error: erroFuturos } = await base()
    .gt('data_vencimento', hoje)
    .order('ultima_consulta_sicoob', { ascending: true, nullsFirst: true })
    .order('data_vencimento', { ascending: true })
    .limit(limit - escolhidos.length);
  if (erroFuturos) throw new Error(erroFuturos.message);
  return [...escolhidos, ...(futuros ?? [])];
}

function montarLoteConsulta(sicoob, c6, limit) {
  const lote = [];
  let i = 0;
  let j = 0;
  while (lote.length < limit && (i < sicoob.length || j < c6.length)) {
    if (i < sicoob.length) lote.push(sicoob[i++]);
    if (lote.length >= limit) break;
    if (j < c6.length) lote.push(c6[j++]);
  }
  return lote;
}

async function sincronizarBoletosPendentesUsuario(admin, userId, limit = 8, opts = {}) {
  const rodada = Number(opts.rodada) || 0;
  const janelas = Math.max(1, Number(opts.janelas) || 1);
  const inicio = Date.now();
  const deadline = inicio + 45000;
  const resultados = [];

  if (rodada === 0) {
    try {
      await reconciliarTitulosPagosPeloBanco(admin, userId);
    } catch (e) {
      resultados.push({ boletoId: null, origem: 'reconciliar', baixado: false, erro: e.message });
    }
  }

  try {
    const liquidacoes = await baixarLiquidacoesSicoob(admin, userId, rodada, janelas, deadline);
    resultados.push(...liquidacoes.resultados);
  } catch (e) {
    resultados.push({ boletoId: null, origem: 'movimentacao', baixado: false, erro: e.message });
  }

  const [filaSicoob, filaC6] = await Promise.all([
    listarBoletosParaConsulta(admin, userId, limit, 'sicoob'),
    listarBoletosParaConsulta(admin, userId, limit, 'c6'),
  ]);
  const boletos = montarLoteConsulta(filaSicoob, filaC6, limit);

  for (const row of boletos) {
    if (Date.now() > deadline) break;
    try {
      const r = await consultarEBaixarBoleto(admin, userId, row.id, 'POLLING');
      resultados.push({ boletoId: row.id, ...r });
    } catch (e) {
      await admin
        .from('boletos_parcela_venda')
        .update({ ultima_consulta_sicoob: new Date().toISOString() })
        .eq('id', row.id);
      resultados.push({ boletoId: row.id, baixado: false, erro: e.message });
    }
  }

  const baixados = resultados.filter((r) => r.baixado).length;
  const consultadosBoleto = resultados.filter((r) => r.boletoId && r.origem !== 'movimentacao').length;
  return {
    consultados: consultadosBoleto,
    baixados,
    temMais:
      rodada + janelas < 15 ||
      consultadosBoleto < boletos.length ||
      filaSicoob.length === limit ||
      filaC6.length === limit,
    resultados,
  };
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
      const r = await sincronizarBoletosPendentesUsuario(admin, userId, limitPorUsuario, {
        rodada: 0,
        janelas: 15,
      });
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
