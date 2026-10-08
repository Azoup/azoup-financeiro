/**
 * Após autorizar a NFS-e: envia a DANFE (HTML) e o XML a todos os e-mails do cliente.
 * Mesmo remetente do boleto (Resend). Falha de e-mail não desfaz a nota.
 */
const { enviarEmailResend, fetchEmailsClienteAdmin } = require('../../boleto/_lib/enviarEmailBoleto');

function safeTrim(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function formatBRL(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function htmlSemBotaoImprimir(html) {
  return String(html).replace(/<p class="noprint"[\s\S]*?<\/p>/gi, '');
}

async function baixarHtmlDanfe(admin, storagePath) {
  const path = safeTrim(storagePath);
  if (!path) return null;
  const { data, error } = await admin.storage.from('nota_fiscal_danfe').download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const html = buf.toString('utf8');
  return html.includes('<html') ? htmlSemBotaoImprimir(html) : null;
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
      'A DANFE segue em anexo.',
      '',
      'Qualquer dúvida, estamos à disposição.',
      'WhatsApp: (19) 98111-1724',
      '',
      'Atenciosamente.',
    ].filter((l) => l != null);

    const attachments = [];
    const html = await baixarHtmlDanfe(admin, danfeStoragePath);
    if (html) {
      attachments.push({
        filename: `DANFSe_${serie}_${numero}.html`,
        content: Buffer.from(html, 'utf8').toString('base64'),
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
