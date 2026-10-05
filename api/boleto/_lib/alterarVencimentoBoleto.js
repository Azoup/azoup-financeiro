const { cleanupTemp, alterarVencimentoBoletoC6Api, consultarBoletoC6Api, obterPdfBoletoC6Api } = require('./c6Client');
const { loadC6Credentials } = require('./c6Credentials');
const {
  alterarBoletoSicoobApi,
  cleanupCert,
  consultarBoletoSicoobApi,
  obterSegundaViaSicoobApi,
} = require('./sicoobClient');
const { loadSicoobCredentials } = require('./sicoobCredentials');
const { mensagemSegundoBoleto } = require('./umBoletoPorClienteDia');

function diaIso(valor) {
  const s = String(valor ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return '';
}

function dataValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function somarMeses(iso, meses) {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), dia)).toISOString().slice(0, 10);
}

function dataBR(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function campoJaAplicado(msg) {
  return /ao menos um campo deve ser alterado/i.test(String(msg ?? ''));
}

function registradoNoC6(boleto) {
  return boleto.tipo_emissao === 'c6' && Boolean(boleto.c6_boleto_id);
}

function registradoNoSicoob(boleto) {
  if (registradoNoC6(boleto)) return false;
  return boleto.tipo_emissao === 'sicoob' && Boolean(boleto.nosso_numero_banco);
}

async function garantirUnicoNoDia(admin, userId, boleto, dia) {
  let clienteId = null;
  if (boleto.mensalidade_id) {
    const { data, error } = await admin
      .from('mensalidades')
      .select('cliente_id')
      .eq('id', boleto.mensalidade_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    clienteId = data?.cliente_id ?? null;
  } else if (boleto.venda_id) {
    const { data, error } = await admin
      .from('vendas')
      .select('cliente_id')
      .eq('id', boleto.venda_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    clienteId = data?.cliente_id ?? null;
  }
  if (clienteId == null || clienteId === '') return;

  const { data: mens, error: eM } = await admin
    .from('mensalidades')
    .select('id')
    .eq('user_id', userId)
    .eq('cliente_id', clienteId);
  if (eM) throw new Error(eM.message);
  const mensIds = (mens ?? []).map((m) => m.id);
  for (let i = 0; i < mensIds.length; i += 80) {
    const { data, error } = await admin
      .from('boletos_parcela_venda')
      .select('id')
      .eq('user_id', userId)
      .eq('data_vencimento', dia)
      .in('mensalidade_id', mensIds.slice(i, i + 80))
      .neq('id', boleto.id)
      .neq('status_registro', 'baixado');
    if (error) throw new Error(error.message);
    if ((data ?? []).length) throw new Error(mensagemSegundoBoleto(dia));
  }

  const { data: vendas, error: eV } = await admin
    .from('vendas')
    .select('id')
    .eq('user_id', userId)
    .eq('cliente_id', clienteId);
  if (eV) throw new Error(eV.message);
  const vendaIds = (vendas ?? []).map((v) => v.id);
  for (let i = 0; i < vendaIds.length; i += 80) {
    const { data, error } = await admin
      .from('boletos_parcela_venda')
      .select('id')
      .eq('user_id', userId)
      .eq('data_vencimento', dia)
      .in('venda_id', vendaIds.slice(i, i + 80))
      .neq('id', boleto.id)
      .neq('status_registro', 'baixado');
    if (error) throw new Error(error.message);
    if ((data ?? []).length) throw new Error(mensagemSegundoBoleto(dia));
  }
}

async function gravarLocal(admin, userId, boleto, nova, extras) {
  const { error } = await admin
    .from('boletos_parcela_venda')
    .update({ data_vencimento: nova, ...extras })
    .eq('id', boleto.id)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  if (boleto.mensalidade_id) {
    const { error: eM } = await admin
      .from('mensalidades')
      .update({ data_vencimento: nova })
      .eq('id', boleto.mensalidade_id)
      .eq('user_id', userId);
    if (eM) throw new Error(eM.message);
  }
  if (boleto.parcela_id) {
    const { error: eP } = await admin
      .from('parcelas_venda')
      .update({ data_vencimento: nova })
      .eq('id', boleto.parcela_id);
    if (eP) throw new Error(eP.message);
  }
}

async function salvarPdfBase64(admin, bucket, userId, boletoId, base64) {
  if (!base64) return {};
  const buf = Buffer.from(String(base64), 'base64');
  if (!buf.length) return {};
  const path = `${userId}/boletos/${boletoId}.pdf`;
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, buf, { contentType: 'application/pdf', upsert: true });
  if (error) return {};
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 30);
  return { pdf_storage_path: path, pdf_url: data?.signedUrl ?? null };
}

async function salvarPdfBuffer(admin, bucket, userId, boletoId, buffer) {
  if (!buffer?.length) return {};
  const path = `${userId}/boletos/${boletoId}.pdf`;
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (error) return {};
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 30);
  return { pdf_storage_path: path, pdf_url: data?.signedUrl ?? null };
}

async function registrarHistorico(admin, boletoId, userId, acao, detalhes) {
  try {
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boletoId,
      acao,
      usuario_id: userId,
      detalhes,
    });
  } catch {
    /* histórico não impede a alteração */
  }
}

async function alterarNoSicoob(admin, userId, boleto, nova) {
  const creds = await loadSicoobCredentials(admin, userId, boleto.emitente_id);
  if (!creds) throw new Error('Sicoob inativo ou sem certificado — o vencimento não foi alterado.');
  try {
    const antes = await consultarBoletoSicoobApi({
      config: creds.config,
      certPath: creds.certPath,
      senha: creds.senha,
      boleto,
    });
    if (antes.liquidado) throw new Error('Este boleto já está pago no Sicoob. O vencimento não foi alterado.');

    const vencimentoBanco = diaIso(antes.resultado?.dataVencimento);
    const limite = diaIso(antes.resultado?.dataLimitePagamento);
    let limiteMovido = false;

    if (vencimentoBanco !== nova) {
      if (limite && nova >= limite) {
        const novoLimite = somarMeses(nova, 6);
        try {
          await alterarBoletoSicoobApi({
            config: creds.config,
            certPath: creds.certPath,
            senha: creds.senha,
            nossoNumero: boleto.nosso_numero_banco,
            objeto: { prorrogacaoLimitePagamento: { dataLimitePagamento: novoLimite } },
          });
          limiteMovido = true;
        } catch (error) {
          if (!campoJaAplicado(error.message)) throw error;
        }
      }

      try {
        await alterarBoletoSicoobApi({
          config: creds.config,
          certPath: creds.certPath,
          senha: creds.senha,
          nossoNumero: boleto.nosso_numero_banco,
          objeto: { prorrogacaoVencimento: { dataVencimento: nova } },
        });
      } catch (error) {
        if (!campoJaAplicado(error.message)) throw error;
        const deNovo = await consultarBoletoSicoobApi({
          config: creds.config,
          certPath: creds.certPath,
          senha: creds.senha,
          boleto,
        });
        if (diaIso(deNovo.resultado?.dataVencimento) !== nova) throw error;
      }
    }

    const extras = {};
    let pdfAtualizado = false;
    try {
      const via = await obterSegundaViaSicoobApi({
        config: creds.config,
        certPath: creds.certPath,
        senha: creds.senha,
        nossoNumero: boleto.nosso_numero_banco,
      });
      if (diaIso(via.data_vencimento) === nova) {
        if (via.linha_digitavel) extras.linha_digitavel = via.linha_digitavel;
        if (via.codigo_barras) extras.codigo_barras = via.codigo_barras;
        Object.assign(extras, await salvarPdfBase64(admin, 'boletos_sicoob', userId, boleto.id, via.pdf_base64));
        pdfAtualizado = Boolean(extras.pdf_url);
      }
    } catch {
      /* a data já foi aceita; o PDF pode atrasar no Sicoob */
    }

    try {
      await gravarLocal(admin, userId, boleto, nova, extras);
    } catch (error) {
      throw new Error(
        `O Sicoob já ficou com vencimento ${dataBR(nova)}, mas o sistema não gravou: ${error.message}`,
      );
    }

    await registrarHistorico(
      admin,
      boleto.id,
      userId,
      'ALTERACAO_VENCIMENTO_SICOOB',
      `Vencimento alterado para ${nova}.`,
    );

    let message = `Vencimento alterado para ${dataBR(nova)} no sistema e no Sicoob.`;
    if (limiteMovido) {
      message += ' A data limite foi para 6 meses depois, porque o Sicoob não aceita vencimento igual ou depois do limite.';
    }
    if (!pdfAtualizado) {
      message += ' O PDF pode levar alguns minutos para mostrar a data nova.';
    }
    return { success: true, banco: 'sicoob', dataVencimento: nova, message };
  } finally {
    cleanupCert(creds.certPath);
  }
}

async function alterarNoC6(admin, userId, boleto, nova) {
  const creds = await loadC6Credentials(admin, userId, boleto.emitente_id);
  try {
    const antes = await consultarBoletoC6Api({
      config: creds.config,
      certPath: creds.certPath,
      keyPath: creds.keyPath,
      c6BoletoId: boleto.c6_boleto_id,
    });
    if (antes.liquidado) throw new Error('Este boleto já está pago no C6. O vencimento não foi alterado.');

    const atual = diaIso(antes.resultado?.due_date ?? antes.resultado?.dueDate);
    let resposta = null;
    if (atual !== nova) {
      resposta = await alterarVencimentoBoletoC6Api({
        config: creds.config,
        certPath: creds.certPath,
        keyPath: creds.keyPath,
        c6BoletoId: boleto.c6_boleto_id,
        dueDate: nova,
      });
    }

    const extras = {};
    if (resposta?.linha_digitavel) extras.linha_digitavel = resposta.linha_digitavel;
    if (resposta?.codigo_barras) extras.codigo_barras = resposta.codigo_barras;
    let pdfAtualizado = false;
    try {
      const pdf = await obterPdfBoletoC6Api({
        config: creds.config,
        certPath: creds.certPath,
        keyPath: creds.keyPath,
        c6BoletoId: boleto.c6_boleto_id,
      });
      Object.assign(extras, await salvarPdfBuffer(admin, 'boletos_c6', userId, boleto.id, pdf));
      pdfAtualizado = Boolean(extras.pdf_url);
    } catch {
      /* PDF do C6 pode atrasar depois da alteração */
    }

    try {
      await gravarLocal(admin, userId, boleto, nova, extras);
    } catch (error) {
      throw new Error(`O C6 já ficou com vencimento ${dataBR(nova)}, mas o sistema não gravou: ${error.message}`);
    }

    await registrarHistorico(admin, boleto.id, userId, 'ALTERACAO_VENCIMENTO_C6', `Vencimento alterado para ${nova}.`);

    let message = `Vencimento alterado para ${dataBR(nova)} no sistema e no C6.`;
    if (!pdfAtualizado) message += ' O PDF pode levar alguns minutos para mostrar a data nova.';
    return { success: true, banco: 'c6', dataVencimento: nova, message };
  } finally {
    if (!creds.bundled) {
      cleanupTemp(creds.certPath);
      cleanupTemp(creds.keyPath);
    }
  }
}

async function alterarVencimentoBoleto(admin, userId, boletoId, dataVencimento) {
  const nova = diaIso(dataVencimento);
  if (!dataValida(nova)) throw new Error('Informe uma data de vencimento válida.');

  const { data: boleto, error } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!boleto) throw new Error('Boleto não encontrado.');
  if (boleto.status_registro === 'pago') throw new Error('Boleto pago não tem vencimento para alterar.');
  if (boleto.status_registro === 'baixado') throw new Error('Boleto cancelado não tem vencimento para alterar.');

  if (diaIso(boleto.data_vencimento) === nova && !registradoNoSicoob(boleto) && !registradoNoC6(boleto)) {
    return { success: true, banco: null, dataVencimento: nova, message: 'Esta já é a data de vencimento.' };
  }

  await garantirUnicoNoDia(admin, userId, boleto, nova);

  if (registradoNoC6(boleto) && !registradoNoSicoob(boleto)) {
    return alterarNoC6(admin, userId, boleto, nova);
  }
  if (registradoNoSicoob(boleto)) {
    return alterarNoSicoob(admin, userId, boleto, nova);
  }

  await gravarLocal(admin, userId, boleto, nova, {});
  return {
    success: true,
    banco: null,
    dataVencimento: nova,
    message: `Vencimento alterado para ${dataBR(nova)} no sistema. Este boleto ainda não está no banco; quando registrar, sai com esta data.`,
  };
}

module.exports = { alterarVencimentoBoleto };
