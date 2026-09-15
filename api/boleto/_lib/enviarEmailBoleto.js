/**
 * Envio automático do boleto por e-mail (Resend).
 * From: EMAIL_FROM ou Azoup <jessica@azoup.com.br>
 * To: primeiro e-mail em contatos_cliente do cliente do boleto.
 * API key: só RESEND_API_KEY (nunca hardcoded).
 */

const DEFAULT_FROM = 'Azoup <jessica@azoup.com.br>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeTrim(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function formatBRL(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatBRDate(iso) {
  const s = safeTrim(iso);
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function isEmailValido(email) {
  const s = safeTrim(email);
  return Boolean(s) && EMAIL_RE.test(s);
}

async function fetchEmailClienteAdmin(admin, clienteId) {
  const id = safeTrim(clienteId);
  if (!id) return null;
  const { data, error } = await admin
    .from('contatos_cliente')
    .select('valor_contato')
    .eq('cliente_id', id)
    .eq('tipo_contato', 'email')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const email = safeTrim(data?.valor_contato);
  return isEmailValido(email) ? email : null;
}

async function resolveClienteId(admin, boleto) {
  if (boleto.mensalidade_id) {
    const { data } = await admin
      .from('mensalidades')
      .select('cliente_id')
      .eq('id', boleto.mensalidade_id)
      .maybeSingle();
    return data?.cliente_id ?? null;
  }
  if (boleto.venda_id) {
    const { data } = await admin.from('vendas').select('cliente_id').eq('id', boleto.venda_id).maybeSingle();
    return data?.cliente_id ?? null;
  }
  return null;
}

async function baixarPdfBytes(admin, boleto) {
  if (boleto.pdf_url) {
    try {
      const res = await fetch(boleto.pdf_url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 100) return buf;
      }
    } catch {
      /* tenta storage */
    }
  }

  const path = safeTrim(boleto.pdf_storage_path);
  if (!path) return null;

  const buckets =
    boleto.tipo_emissao === 'c6' ? ['boletos_c6', 'boletos_sicoob'] : ['boletos_sicoob', 'boletos_c6'];

  for (const bucket of buckets) {
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) continue;
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length > 100) return buf;
  }
  return null;
}

function buildCorpo({ nomeCliente, referencia, valor, vencimento, numeroDocumento, linhaDigitavel, pix }) {
  const linhas = [
    `Olá, ${nomeCliente || 'cliente'}!`,
    '',
    'Segue o boleto para pagamento:',
    `• ${referencia || 'Cobrança'}`,
    `• Valor: ${formatBRL(valor)}`,
    `• Vencimento: ${vencimento || '—'}`,
    numeroDocumento ? `• Documento: ${numeroDocumento}` : null,
    linhaDigitavel ? `\nLinha digitável:\n${linhaDigitavel}` : null,
    pix ? `\nPix Copia e Cola:\n${pix}` : null,
    '',
    'O boleto segue em anexo.',
    '',
    'Qualquer dúvida, estamos à disposição.',
    'Atenciosamente.',
    'Azoup',
  ].filter((l) => l != null);
  return linhas.join('\n');
}

function corpoHtml(texto) {
  const escaped = String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.45">${escaped}</div>`;
}

/**
 * Envia e-mail via Resend HTTP API.
 * @returns {{ enviado?: boolean, skipped?: boolean, reason?: string, to?: string, error?: string }}
 */
async function enviarEmailResend({ to, subject, text, pdfBuffer, filename }) {
  const apiKey = safeTrim(process.env.RESEND_API_KEY);
  if (!apiKey) {
    return { skipped: true, reason: 'email_nao_configurado' };
  }

  const from = safeTrim(process.env.EMAIL_FROM) || DEFAULT_FROM;

  const payload = {
    from,
    to: [to],
    subject,
    text,
    html: corpoHtml(text),
  };

  if (pdfBuffer?.length) {
    payload.attachments = [
      {
        filename: filename || 'boleto.pdf',
        content: pdfBuffer.toString('base64'),
      },
    ];
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      body?.message ||
      body?.error?.message ||
      (typeof body?.error === 'string' ? body.error : null) ||
      `Resend HTTP ${res.status}`;
    return { skipped: false, enviado: false, error: msg, to };
  }

  return { enviado: true, to, id: body?.id ?? null };
}

/**
 * Após emitir boleto com sucesso: envia PDF ao e-mail do cadastro.
 * Não lança — falha de e-mail não desfaz o boleto.
 */
async function tentarEnviarEmailAposEmissao(admin, userId, emitResult) {
  try {
    if (!emitResult?.success || emitResult.emitido_agora === false) {
      return { skipped: true, reason: 'nao_recem_emitido' };
    }
    if (
      emitResult.status_registro &&
      emitResult.status_registro !== 'registrado' &&
      !emitResult.pdf_url &&
      !emitResult.c6_boleto_id
    ) {
      return { skipped: true, reason: 'boleto_nao_registrado' };
    }

    const boletoId = emitResult.boletoId;
    if (!boletoId) return { skipped: true, reason: 'sem_boleto_id' };

    const { data: boleto, error } = await admin
      .from('boletos_parcela_venda')
      .select('*')
      .eq('id', boletoId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return { skipped: false, enviado: false, error: error.message };
    if (!boleto) return { skipped: true, reason: 'boleto_nao_encontrado' };

    const clienteId = await resolveClienteId(admin, boleto);
    if (!clienteId) return { skipped: true, reason: 'sem_cliente' };

    const to = await fetchEmailClienteAdmin(admin, clienteId);
    if (!to) return { skipped: true, reason: 'sem_email_cadastro' };

    const { data: cliente } = await admin
      .from('clientes')
      .select('nome_fantasia, nome')
      .eq('id', clienteId)
      .maybeSingle();

    // C6 modo rápido: tenta baixar PDF uma vez antes de enviar.
    let pdfUrl = boleto.pdf_url;
    let pdfStoragePath = boleto.pdf_storage_path;
    if (!pdfUrl && !pdfStoragePath && boleto.c6_boleto_id && boleto.emitente_id) {
      try {
        const { baixarESalvarPdfC6 } = require('./emitirBoletoC6');
        const { loadC6Credentials } = require('./c6Credentials');
        const { cleanupTemp } = require('./c6Client');
        const creds = await loadC6Credentials(admin, userId, boleto.emitente_id);
        try {
          const pdf = await baixarESalvarPdfC6(
            admin,
            userId,
            boletoId,
            creds,
            boleto.c6_boleto_id,
            null,
          );
          if (pdf.pdfUrl || pdf.pdfStoragePath) {
            pdfUrl = pdf.pdfUrl;
            pdfStoragePath = pdf.pdfStoragePath;
            await admin
              .from('boletos_parcela_venda')
              .update({
                pdf_url: pdfUrl,
                pdf_storage_path: pdfStoragePath,
              })
              .eq('id', boletoId);
            boleto.pdf_url = pdfUrl;
            boleto.pdf_storage_path = pdfStoragePath;
          }
        } finally {
          if (!creds.bundled) {
            cleanupTemp(creds.certPath);
            cleanupTemp(creds.keyPath);
          }
        }
      } catch (e) {
        console.warn('[email-boleto] PDF C6 indisponível:', e.message);
      }
    }

    const pdfBuffer = await baixarPdfBytes(admin, boleto);
    if (!pdfBuffer?.length) {
      return { skipped: true, reason: 'sem_pdf', to };
    }

    const nomeCliente = safeTrim(cliente?.nome_fantasia) || safeTrim(cliente?.nome) || 'cliente';
    const referencia =
      safeTrim(boleto.venda_descricao_resumo)?.split('\n')[0] ||
      (boleto.origem === 'mensalidade' ? 'Mensalidade' : 'Cobrança');
    const subject = `Boleto — ${referencia}`.slice(0, 200);
    const text = buildCorpo({
      nomeCliente,
      referencia,
      valor: boleto.valor_documento,
      vencimento: formatBRDate(boleto.data_vencimento),
      numeroDocumento: safeTrim(boleto.numero_documento),
      linhaDigitavel: safeTrim(boleto.linha_digitavel) || safeTrim(emitResult.linha_digitavel),
      pix: safeTrim(boleto.pix_copia_cola) || safeTrim(emitResult.pix_copia_cola),
    });
    const filename = `boleto_${safeTrim(boleto.numero_documento) || boletoId}.pdf`;

    return await enviarEmailResend({ to, subject, text, pdfBuffer, filename });
  } catch (e) {
    console.warn('[email-boleto]', e.message);
    return { skipped: false, enviado: false, error: e.message || 'Falha ao enviar e-mail' };
  }
}

module.exports = {
  tentarEnviarEmailAposEmissao,
  enviarEmailResend,
  fetchEmailClienteAdmin,
};
