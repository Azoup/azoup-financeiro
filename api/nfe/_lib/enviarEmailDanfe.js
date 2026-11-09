/**
 * Após autorizar a NFS-e: envia a DANFE (PDF) e o XML a todos os e-mails do cliente.
 * Mesmo remetente do boleto (Resend). Falha de e-mail não desfaz a nota.
 */
const { enviarEmailResend, fetchEmailsClienteAdmin } = require('../../boleto/_lib/enviarEmailBoleto');
const {
  buildDanfsePdfBuffer,
  enriquecerMetaDoXml,
  extrairXmlNfse,
} = require('./nfseDanfseArtifacts');

function safeTrim(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function formatBRL(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function isPdfBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

async function baixarStorageBuffer(admin, storagePath) {
  const path = safeTrim(storagePath);
  if (!path) return null;
  const { data, error } = await admin.storage.from('nota_fiscal_danfe').download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function metaMinimaDaNota(nota) {
  return {
    numero:
      safeTrim(nota?.protocolo_autorizacao)?.replace(/\D/g, '') ||
      safeTrim(nota?.numero) ||
      '—',
    serie: safeTrim(nota?.serie) || '1',
    rpsNumero: safeTrim(nota?.numero),
    rpsSerie: safeTrim(nota?.serie) || '1',
    codigoVerificacao: safeTrim(nota?.codigo_verificacao),
    chaveAcesso: safeTrim(nota?.chave_acesso),
    valor: nota?.valor_total,
    competencia: safeTrim(nota?.competencia),
    dataEmissao: nota?.data_emissao || String(nota?.data_emissao || '').slice(0, 10),
    discriminacao: 'Prestação de serviços',
    prestadorNome: 'Prestador',
    tomadorNome: 'Tomador',
  };
}

/**
 * Preferência: PDF já no Storage → gera PDF a partir do XML/meta → null.
 */
async function obterPdfDanfeAnexo(admin, { nota, danfeStoragePath, xml }) {
  const path = safeTrim(danfeStoragePath);
  if (path) {
    const buf = await baixarStorageBuffer(admin, path);
    if (buf && isPdfBuffer(buf)) return buf;
    // Path antigo .html ou conteúdo HTML: regenera PDF
  }

  const xmlTexto = safeTrim(xml) || (typeof nota?.xml_autorizado === 'string' ? nota.xml_autorizado : '');
  const xmlLimpo = extrairXmlNfse(xmlTexto) || xmlTexto;
  try {
    const meta = enriquecerMetaDoXml(metaMinimaDaNota(nota), xmlLimpo);
    return buildDanfsePdfBuffer(meta);
  } catch (e) {
    console.warn('[email-danfe] pdf fallback:', e?.message || e);
    try {
      return buildDanfsePdfBuffer(metaMinimaDaNota(nota));
    } catch (e2) {
      console.warn('[email-danfe] pdf minimo:', e2?.message || e2);
      return null;
    }
  }
}

async function tentarEnviarEmailDanfe(admin, { nota, cliente, danfeStoragePath, xml, danfeUrl }) {
  try {
    const clienteId = nota?.cliente_id || cliente?.id;
    const to = await fetchEmailsClienteAdmin(admin, clienteId);
    if (!to.length) return { skipped: true, reason: 'sem_email_cadastro' };

    const nome = safeTrim(cliente?.nome) || safeTrim(cliente?.nome_fantasia) || 'cliente';
    const serie = safeTrim(nota?.serie) || '1';
    const numero = safeTrim(nota?.numero) || 's_numero';
    const linhas = [
      `Olá, ${nome}!`,
      '',
      'Segue a NFS-e referente ao serviço prestado:',
      `• Nota: ${serie}/${numero}`,
      `• Valor: ${formatBRL(nota?.valor_total)}`,
      nota?.competencia ? `• Competência: ${safeTrim(nota.competencia)}` : null,
      nota?.codigo_verificacao
        ? `• Código de verificação: ${safeTrim(nota.codigo_verificacao)}`
        : null,
      '',
      'A DANFE segue em anexo (PDF).',
      '',
      'Qualquer dúvida, estamos à disposição.',
      'WhatsApp: (19) 98111-1724',
      '',
      'Atenciosamente.',
    ].filter((l) => l != null);

    const attachments = [];
    const pdfBuf = await obterPdfDanfeAnexo(admin, { nota, danfeStoragePath, xml });
    if (pdfBuf && pdfBuf.length) {
      attachments.push({
        filename: `DANFSe_${serie}_${numero}.pdf`,
        content: pdfBuf.toString('base64'),
      });
    }
    const xmlTexto = safeTrim(xml);
    if (xmlTexto) {
      attachments.push({
        filename: `NFSe_${serie}_${numero}.xml`,
        content: Buffer.from(xmlTexto, 'utf8').toString('base64'),
      });
    }
    if (!attachments.length && !danfeUrl) {
      return { skipped: true, reason: 'sem_pdf', to: to.join(', ') };
    }

    return await enviarEmailResend({
      to,
      subject: `NFS-e ${serie}/${numero}`.slice(0, 200),
      text: linhas.join('\n'),
      attachments,
    });
  } catch (e) {
    console.warn('[email-danfe]', e?.message || e);
    return { skipped: false, enviado: false, error: e?.message || 'Falha ao enviar DANFE.' };
  }
}

/** Reenvio manual, o mesmo caminho do boleto: Resend, sem abrir o Outlook. */
async function reenviarEmailDanfe(admin, userId, notaFiscalId) {
  const { data: nota, error } = await admin
    .from('nota_fiscal')
    .select('*')
    .eq('id', notaFiscalId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!nota) throw new Error('Nota não encontrada.');
  if (nota.status !== 'autorizada') {
    throw new Error('Só é possível enviar por e-mail uma nota autorizada.');
  }

  const { data: cliente } = await admin
    .from('clientes')
    .select('id, nome, nome_fantasia')
    .eq('id', nota.cliente_id)
    .maybeSingle();

  const xml = typeof nota.xml_autorizado === 'string' ? nota.xml_autorizado : '';
  return tentarEnviarEmailDanfe(admin, {
    nota,
    cliente,
    danfeStoragePath: nota.danfe_storage_path,
    xml,
    danfeUrl: nota.danfe_url,
  });
}

module.exports = { tentarEnviarEmailDanfe, reenviarEmailDanfe };
