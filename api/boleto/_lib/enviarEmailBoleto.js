/**
 * Envio automático do boleto por e-mail (Resend).
 * From: EMAIL_FROM ou Azoup <jessica@azoup.com.br>
 * To: todos os e-mails em contatos_cliente do cliente do boleto.
 * API key: só RESEND_API_KEY (nunca hardcoded).
 */

const { calcularEncargosBoleto } = require('./boletoEncargos');
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

async function fetchEmailsClienteAdmin(admin, clienteId) {
  const id = safeTrim(clienteId);
  if (!id) return [];
  const { data, error } = await admin
    .from('contatos_cliente')
    .select('valor_contato')
    .eq('cliente_id', id)
    .eq('tipo_contato', 'email')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const emails = [];
  const vistos = new Set();
  for (const row of data ?? []) {
    const email = safeTrim(row?.valor_contato);
    if (!isEmailValido(email)) continue;
    const chave = email.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    emails.push(email);
  }
  return emails;
}

async function fetchEmailClienteAdmin(admin, clienteId) {
  const emails = await fetchEmailsClienteAdmin(admin, clienteId);
  return emails[0] ?? null;
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

function buildCorpo({ nomeCliente, referencia, valor, vencimento, numeroDocumento, linhaDigitavel, pix, encargos }) {
  const linhas = [
    `Olá, ${nomeCliente || 'cliente'}!`,
    '',
    'Segue o boleto para pagamento:',
    `• ${referencia || 'Cobrança'}`,
    encargos?.vencido ? `• Valor original: ${formatBRL(valor)}` : `• Valor: ${formatBRL(valor)}`,
    encargos?.vencido ? `• Multa (2%): ${formatBRL(encargos.multa)}` : null,
    encargos?.vencido
      ? `• Juros (0,033% ao dia × ${encargos.dias} dia(s)): ${formatBRL(encargos.juros)}`
      : null,
    encargos?.vencido ? `• Valor para pagamento hoje: ${formatBRL(encargos.total)}` : null,
    `• Vencimento: ${vencimento || '—'}`,
    numeroDocumento ? `• Documento: ${numeroDocumento}` : null,
    linhaDigitavel ? `\nLinha digitável:\n${linhaDigitavel}` : null,
    pix ? `\nPix Copia e Cola:\n${pix}` : null,
    '',
    'O boleto segue em anexo.',
    '',
    'Qualquer dúvida, estamos à disposição.',
    'WhatsApp: (19) 98111-1724',
    '',
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
async function enviarEmailResend({ to, subject, text, pdfBuffer, filename, attachments }) {
  const apiKey = safeTrim(process.env.RESEND_API_KEY);
  if (!apiKey) {
    return { skipped: true, reason: 'email_nao_configurado' };
  }

  const from = safeTrim(process.env.EMAIL_FROM) || DEFAULT_FROM;

  const lista = (Array.isArray(to) ? to : [to]).map((item) => safeTrim(item)).filter(isEmailValido);
  const destinatarios = [];
  const vistos = new Set();
  for (const email of lista) {
    const chave = email.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    destinatarios.push(email);
  }
  if (!destinatarios.length) {
    return { skipped: true, reason: 'sem_email_cadastro' };
  }

  const payload = {
    from,
    to: destinatarios,
    subject,
    text,
    html: corpoHtml(text),
  };

  const files = Array.isArray(attachments) ? [...attachments] : [];
  if (pdfBuffer?.length) {
    files.push({
      filename: filename || 'boleto.pdf',
      content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : String(pdfBuffer),
    });
  }
  if (files.length) payload.attachments = files;

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
    return { skipped: false, enviado: false, error: msg, to: destinatarios.join(', ') };
  }

  return { enviado: true, to: destinatarios.join(', '), id: body?.id ?? null };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Baixa PDF oficial C6 (com retries) e grava no boleto. */
async function tentarBaixarPdfC6ComRetry(admin, userId, boleto, tentativas = 3) {
  if (!boleto?.c6_boleto_id || !boleto?.emitente_id) return boleto;
  const { baixarESalvarPdfC6 } = require('./emitirBoletoC6');
  const { loadC6Credentials } = require('./c6Credentials');
  const { cleanupTemp } = require('./c6Client');
  let creds;
  try {
    creds = await loadC6Credentials(admin, userId, boleto.emitente_id);
  } catch (e) {
    console.warn('[email-boleto] credenciais C6:', e?.message || e);
    return boleto;
  }
  try {
    for (let i = 0; i < tentativas; i += 1) {
      if (i > 0) await sleep(1500 * i);
      try {
        const pdf = await baixarESalvarPdfC6(
          admin,
          userId,
          boleto.id,
          creds,
          boleto.c6_boleto_id,
          null,
        );
        if (pdf?.pdfUrl || pdf?.pdfStoragePath) {
          boleto.pdf_url = pdf.pdfUrl || boleto.pdf_url;
          boleto.pdf_storage_path = pdf.pdfStoragePath || boleto.pdf_storage_path;
          await admin
            .from('boletos_parcela_venda')
            .update({
              pdf_url: boleto.pdf_url,
              pdf_storage_path: boleto.pdf_storage_path,
              status_registro:
                boleto.status_registro === 'pendente' ? 'registrado' : boleto.status_registro,
            })
            .eq('id', boleto.id);
          return boleto;
        }
      } catch (e) {
        console.warn('[email-boleto] PDF C6 tentativa', i + 1, e?.message || e);
      }
    }
  } finally {
    if (creds && !creds.bundled) {
      cleanupTemp(creds.certPath);
      cleanupTemp(creds.keyPath);
    }
  }
  return boleto;
}

/**
 * Garante um PDF para o e-mail: oficial do banco → retries C6 → carnê local.
 * Assim o envio automático não falha no modo rápido sem PDF pronto.
 */
async function obterPdfBoletoParaEmail(admin, userId, boleto, emitResult) {
  const encargos =
    boleto.status_registro === 'pago' || boleto.status_registro === 'baixado'
      ? null
      : calcularEncargosBoleto(boleto.valor_documento, boleto.data_vencimento);

  // Atrasado: carnê com multa/juros (oficial do banco só tem valor de face).
  if (encargos?.vencido) {
    try {
      const { buildBoletoCobrancaPdfBuffer } = require('./boletoCobrancaPdf');
      const buf = buildBoletoCobrancaPdfBuffer(boleto);
      if (buf?.length) return { pdfBuffer: buf, encargos, fonte: 'encargos' };
    } catch (e) {
      console.warn('[email-boleto] pdf com encargos:', e?.message || e);
    }
  }

  if (
    (boleto.tipo_emissao === 'sicoob' && boleto.nosso_numero_banco) ||
    (boleto.tipo_emissao === 'c6' && boleto.c6_boleto_id)
  ) {
    try {
      const { refreshPdfOficialBoleto } = require('./refreshPdfOficial');
      const refreshed = await refreshPdfOficialBoleto(admin, userId, boleto.id);
      if (refreshed?.pdf_url) {
        boleto.pdf_url = refreshed.pdf_url;
        if (refreshed.pdf_storage_path) boleto.pdf_storage_path = refreshed.pdf_storage_path;
      }
    } catch (e) {
      console.warn('[email-boleto] refresh PDF oficial:', e.message);
    }
  }

  let pdfBuffer = await baixarPdfBytes(admin, boleto);
  if (pdfBuffer?.length) return { pdfBuffer, encargos, fonte: 'storage' };

  if (boleto.c6_boleto_id) {
    await tentarBaixarPdfC6ComRetry(admin, userId, boleto, 3);
    pdfBuffer = await baixarPdfBytes(admin, boleto);
    if (pdfBuffer?.length) return { pdfBuffer, encargos, fonte: 'c6' };
  }

  // Fallback: PDF local com dados do título (linha digitável / Pix quando houver).
  try {
    const { buildBoletoCobrancaPdfBuffer } = require('./boletoCobrancaPdf');
    const boletoEmail = {
      ...boleto,
      linha_digitavel: boleto.linha_digitavel || emitResult?.linha_digitavel || null,
      pix_copia_cola: boleto.pix_copia_cola || emitResult?.pix_copia_cola || null,
    };
    const buf = buildBoletoCobrancaPdfBuffer(boletoEmail);
    if (buf?.length) return { pdfBuffer: buf, encargos, fonte: 'local' };
  } catch (e) {
    console.warn('[email-boleto] pdf local fallback:', e?.message || e);
  }

  return { pdfBuffer: null, encargos, fonte: null };
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
      emitResult.status_registro !== 'pendente' &&
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

    const to = await fetchEmailsClienteAdmin(admin, clienteId);
    if (!to.length) return { skipped: true, reason: 'sem_email_cadastro' };

    const { data: cliente } = await admin
      .from('clientes')
      .select('nome_fantasia, nome')
      .eq('id', clienteId)
      .maybeSingle();

    const nomeCliente = safeTrim(cliente?.nome) || safeTrim(cliente?.nome_fantasia) || 'cliente';
    const referencia =
      safeTrim(boleto.venda_descricao_resumo)?.split('\n')[0] ||
      (boleto.origem === 'mensalidade' ? 'Mensalidade' : 'Cobrança');
    const subject = `Boleto — ${referencia}`.slice(0, 200);

    const { pdfBuffer, encargos } = await obterPdfBoletoParaEmail(admin, userId, boleto, emitResult);
    if (!pdfBuffer?.length) {
      return { skipped: true, reason: 'sem_pdf', to: to.join(', ') };
    }

    const text = buildCorpo({
      nomeCliente,
      referencia,
      valor: boleto.valor_documento,
      vencimento: formatBRDate(boleto.data_vencimento),
      numeroDocumento: safeTrim(boleto.numero_documento),
      linhaDigitavel: safeTrim(boleto.linha_digitavel) || safeTrim(emitResult.linha_digitavel),
      pix: safeTrim(boleto.pix_copia_cola) || safeTrim(emitResult.pix_copia_cola),
      encargos: encargos?.vencido ? encargos : null,
    });
    const filename = `boleto_${safeTrim(boleto.numero_documento) || boletoId}.pdf`;

    const email = await enviarEmailResend({ to, subject, text, pdfBuffer, filename });
    console.info('[email-boleto]', boletoId, email?.enviado ? 'enviado' : email?.reason || email?.error);
    return email;
  } catch (e) {
    console.warn('[email-boleto]', e.message);
    return { skipped: false, enviado: false, error: e.message || 'Falha ao enviar e-mail' };
  }
}

const TEXTO_PENDENCIA_ATE_12 = [
  'Olá! Tudo bem? 😊',
  '',
  'Identificamos que há um boleto pendente referente aos serviços da Azoup.',
  '',
  'Pedimos, por gentileza, que verifique a pendência e, caso o pagamento já tenha sido realizado, desconsidere esta mensagem.',
  '',
  'Se precisar de uma segunda via ou tiver alguma dúvida, entre em contato com nosso atendimento pelo WhatsApp: (19) 98111-1724 ou e-mail financeiro@azoup.com.br',
  '',
  'Agradecemos pela atenção e parceria!',
  '',
  'Equipe Azoup Tecnologia',
].join('\n');

const TEXTO_PENDENCIA_13 = [
  'Olá! Tudo bem? 😊',
  '',
  'Identificamos que há um boleto pendente referente aos serviços da Azoup.',
  '',
  'Pedimos que regularize o pagamento em até 3 dias, para evitar o bloqueio do acesso ao sistema por falta de pagamento.',
  '',
  'Caso o pagamento já tenha sido realizado, por favor, desconsidere esta mensagem.',
  '',
  'Se precisar de uma segunda via, tiver dúvidas sobre o boleto ou necessitar de auxílio para regularização, entre em contato conosco pelo WhatsApp: (19) 98111-1724 ou e-mail: financeiro@azoup.com.br',
  '',
  'Contamos com sua colaboração para evitar qualquer interrupção na utilização do sistema.',
  '',
  'Equipe Azoup Tecnologia',
].join('\n');

function diasEmAberto(dataVencimento) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const venc = String(dataVencimento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje)) return 0;
  const [yh, mh, dh] = hoje.split('-').map((n) => Number(n));
  const [yv, mv, dv] = venc.split('-').map((n) => Number(n));
  const diff = Math.round((Date.UTC(yh, mh - 1, dh) - Date.UTC(yv, mv - 1, dv)) / 86400000);
  return diff > 0 ? diff : 0;
}

async function enviarPendenciaBoleto(admin, userId, boletoId) {
  const id = safeTrim(boletoId);
  if (!id) return { boletoId: id, skipped: true, reason: 'sem_boleto_id' };

  const { data: boleto, error } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { boletoId: id, enviado: false, error: error.message };
  if (!boleto) return { boletoId: id, skipped: true, reason: 'boleto_nao_encontrado' };
  if (boleto.status_registro === 'pago' || boleto.status_registro === 'baixado') {
    return { boletoId: id, skipped: true, reason: 'ja_quitado' };
  }

  const clienteId = await resolveClienteId(admin, boleto);
  if (!clienteId) return { boletoId: id, skipped: true, reason: 'sem_cliente' };

  const to = await fetchEmailsClienteAdmin(admin, clienteId);
  if (!to.length) return { boletoId: id, skipped: true, reason: 'sem_email_cadastro' };

  const pdfBuffer = await baixarPdfBytes(admin, boleto);
  if (!pdfBuffer?.length) return { boletoId: id, skipped: true, reason: 'sem_pdf', to: to.join(', ') };

  const text = diasEmAberto(boleto.data_vencimento) >= 13 ? TEXTO_PENDENCIA_13 : TEXTO_PENDENCIA_ATE_12;
  const filename = `boleto_${safeTrim(boleto.numero_documento) || id}.pdf`;
  const email = await enviarEmailResend({
    to,
    subject: 'Pendência de boleto — Azoup',
    text,
    pdfBuffer,
    filename,
  });
  return { boletoId: id, ...email };
}

module.exports = {
  tentarEnviarEmailAposEmissao,
  enviarEmailResend,
  enviarPendenciaBoleto,
  fetchEmailClienteAdmin,
  fetchEmailsClienteAdmin,
};
