const { cleanupTemp, obterPdfBoletoC6Api, consultarBoletoC6Api } = require('./c6Client');
const { loadC6Credentials } = require('./c6Credentials');
const { cleanupCert, consultarBoletoSicoobApi, obterSegundaViaSicoobApi } = require('./sicoobClient');
const { loadSicoobCredentials } = require('./sicoobCredentials');

function diaIso(valor) {
  const s = String(valor ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Busca o PDF oficial no banco até a data de vencimento bater com a do sistema
 * (ou até esgotar tentativas). Grava no Storage e devolve campos para update.
 */
async function baixarPdfSicoobAlinhado(creds, boleto, dataEsperada, { tentativas = 4, intervaloMs = 2000 } = {}) {
  let ultimo = null;
  for (let i = 0; i < tentativas; i += 1) {
    if (i > 0) await sleep(intervaloMs);
    ultimo = await obterSegundaViaSicoobApi({
      config: creds.config,
      certPath: creds.certPath,
      senha: creds.senha,
      nossoNumero: boleto.nosso_numero_banco,
    });
    if (!dataEsperada || diaIso(ultimo.data_vencimento) === dataEsperada) {
      return { via: ultimo, alinhado: !dataEsperada || diaIso(ultimo.data_vencimento) === dataEsperada };
    }
  }
  return { via: ultimo, alinhado: false };
}

async function refreshPdfSicoob(admin, userId, boleto, dataEsperada) {
  const creds = await loadSicoobCredentials(admin, userId, boleto.emitente_id);
  if (!creds) throw new Error('Sicoob inativo ou sem certificado — o PDF não foi atualizado.');
  try {
    const consulta = await consultarBoletoSicoobApi({
      config: creds.config,
      certPath: creds.certPath,
      senha: creds.senha,
      boleto,
    });
    if (consulta.liquidado) throw new Error('Boleto já liquidado no Sicoob.');

    const esperado = dataEsperada || diaIso(boleto.data_vencimento);
    const { via, alinhado } = await baixarPdfSicoobAlinhado(creds, boleto, esperado);
    if (!via?.pdf_base64) throw new Error('Sicoob não devolveu o PDF da segunda via.');

    const extras = {};
    if (via.linha_digitavel) extras.linha_digitavel = via.linha_digitavel;
    if (via.codigo_barras) extras.codigo_barras = via.codigo_barras;
    Object.assign(extras, await salvarPdfBase64(admin, 'boletos_sicoob', userId, boleto.id, via.pdf_base64));
    if (!extras.pdf_url) throw new Error('Não foi possível gravar o PDF no Storage.');

    const { error } = await admin.from('boletos_parcela_venda').update(extras).eq('id', boleto.id).eq('user_id', userId);
    if (error) throw new Error(error.message);

    return {
      success: true,
      banco: 'sicoob',
      pdfAtualizado: true,
      alinhado,
      dataVencimentoPdf: diaIso(via.data_vencimento) || null,
      dataVencimentoSistema: esperado,
      pdf_url: extras.pdf_url,
      pdf_storage_path: extras.pdf_storage_path,
      message: alinhado
        ? 'PDF oficial atualizado com a data do sistema.'
        : `PDF baixado, mas a segunda via ainda mostra ${diaIso(via.data_vencimento) || 'outra data'}. Tente de novo em alguns minutos.`,
    };
  } finally {
    cleanupCert(creds.certPath);
  }
}

async function refreshPdfC6(admin, userId, boleto, dataEsperada) {
  const creds = await loadC6Credentials(admin, userId, boleto.emitente_id);
  try {
    const consulta = await consultarBoletoC6Api({
      config: creds.config,
      certPath: creds.certPath,
      keyPath: creds.keyPath,
      c6BoletoId: boleto.c6_boleto_id,
    });
    if (consulta.liquidado) throw new Error('Boleto já liquidado no C6.');

    const esperado = dataEsperada || diaIso(boleto.data_vencimento);
    const vencBanco = diaIso(consulta.resultado?.due_date ?? consulta.resultado?.dueDate);
    const pdf = await obterPdfBoletoC6Api({
      config: creds.config,
      certPath: creds.certPath,
      keyPath: creds.keyPath,
      c6BoletoId: boleto.c6_boleto_id,
    });
    const extras = await salvarPdfBuffer(admin, 'boletos_c6', userId, boleto.id, pdf);
    if (!extras.pdf_url) throw new Error('Não foi possível gravar o PDF do C6 no Storage.');

    const { error } = await admin.from('boletos_parcela_venda').update(extras).eq('id', boleto.id).eq('user_id', userId);
    if (error) throw new Error(error.message);

    const alinhado = !esperado || !vencBanco || vencBanco === esperado;
    return {
      success: true,
      banco: 'c6',
      pdfAtualizado: true,
      alinhado,
      dataVencimentoPdf: vencBanco || null,
      dataVencimentoSistema: esperado,
      pdf_url: extras.pdf_url,
      pdf_storage_path: extras.pdf_storage_path,
      message: alinhado
        ? 'PDF oficial do C6 atualizado.'
        : `PDF baixado; no C6 o vencimento ainda aparece como ${vencBanco}. Confira no banco.`,
    };
  } finally {
    if (!creds.bundled) {
      cleanupTemp(creds.certPath);
      cleanupTemp(creds.keyPath);
    }
  }
}

/** Atualiza o PDF em Storage a partir do banco, alinhando à data_vencimento do sistema. */
async function refreshPdfOficialBoleto(admin, userId, boletoId) {
  const { data: boleto, error } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!boleto) throw new Error('Boleto não encontrado.');
  if (boleto.status_registro === 'pago') throw new Error('Boleto pago não tem PDF para atualizar.');
  if (boleto.status_registro === 'baixado') throw new Error('Boleto cancelado não tem PDF para atualizar.');

  const esperado = diaIso(boleto.data_vencimento);
  if (boleto.tipo_emissao === 'c6' && boleto.c6_boleto_id) {
    return refreshPdfC6(admin, userId, boleto, esperado);
  }
  if (boleto.tipo_emissao === 'sicoob' && boleto.nosso_numero_banco) {
    return refreshPdfSicoob(admin, userId, boleto, esperado);
  }
  throw new Error('Boleto ainda não registrado no banco — não há PDF oficial para atualizar.');
}

module.exports = {
  diaIso,
  baixarPdfSicoobAlinhado,
  salvarPdfBase64,
  salvarPdfBuffer,
  refreshPdfOficialBoleto,
  refreshPdfSicoob,
  refreshPdfC6,
};
