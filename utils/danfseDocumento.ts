import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import type { EmitirBoletoEmailResult } from '@/types/sicoob';
import { formatBRL } from '@/utils/currency';
import { buildDanfseHtmlFromNota } from '@/utils/danfseHtml';
import { fetchEmailCliente } from '@/services/clienteContatoService';
import { compartilharComEmail, type CompartilharResultado } from '@/utils/compartilharDocumento';
import { safeTrim } from '@/utils/safeTrim';
import { htmlDanfseParaPdf } from '@/utils/baixarDanfseArquivos';

export async function fetchDanfseHtml(item: NotaFiscalListRow): Promise<{
  html: string;
  danfeUrl: string | null;
}> {
  let htmlApi: string | null = null;
  let danfeUrl: string | null = safeTrim(item.danfe_url) || null;
  const base = nfeApiBaseUrl();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;

  if (item.status === 'autorizada' && base && token) {
    try {
      const res = await fetch(`${base}/api/nfe/artefatos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notaFiscalId: item.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        danfe_url?: string;
        html?: string;
        message?: string;
      };
      if (typeof body.html === 'string' && body.html.includes('<html')) {
        htmlApi = body.html;
      }
      const url = safeTrim(body.danfe_url);
      if (url) danfeUrl = url;
    } catch {
      /* fallback HTML local */
    }
  }

  const html = htmlApi || buildDanfseHtmlFromNota(item);
  return { html, danfeUrl };
}

export function buildCorpoEmailDanfse(item: NotaFiscalListRow): string {
  const nome = safeTrim(item.cliente?.nome_cliente) || 'cliente';
  const serie = safeTrim(item.serie) || '1';
  const numero = safeTrim(item.numero) || '—';
  const linhas = [
    `Olá, ${nome}!`,
    '',
    'Segue a NFS-e referente ao serviço prestado:',
    `• Nota: ${serie}/${numero}`,
    `• Valor: ${formatBRL(item.valor_total)}`,
    item.competencia ? `• Competência: ${safeTrim(item.competencia)}` : null,
    item.codigo_verificacao
      ? `• Código de verificação: ${safeTrim(item.codigo_verificacao)}`
      : null,
    '',
    'O documento DANFSe segue em anexo.',
    '',
    'Qualquer dúvida, estamos à disposição.',
    'Atenciosamente.',
  ].filter((l): l is string => l != null);
  return linhas.join('\n');
}

async function htmlParaPdfBlob(html: string): Promise<{ blob: Blob }> {
  const blob = await htmlDanfseParaPdf(html);
  return { blob };
}

export async function compartilharDanfsePorEmail(item: NotaFiscalListRow): Promise<{
  email: string | null;
  resultado: CompartilharResultado;
}> {
  const email = await fetchEmailCliente(item.cliente_id);
  const { html } = await fetchDanfseHtml(item);
  const serie = safeTrim(item.serie) || '1';
  const numero = safeTrim(item.numero) || 's_numero';
  const subject = `NFS-e ${serie}/${numero}`;
  const body = buildCorpoEmailDanfse(item);
  const filename = `DANFSe_${serie}_${numero}.pdf`;

  try {
    const { blob } = await htmlParaPdfBlob(html);
    const resultado = await compartilharComEmail({
      to: email,
      subject,
      body,
      arquivo: {
        blob,
        filename,
        mimeType: 'application/pdf',
      },
    });
    return { email, resultado };
  } catch {
    // Fallback: anexa HTML se a geração de PDF falhar
    const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const resultado = await compartilharComEmail({
      to: email,
      subject,
      body,
      arquivo: {
        blob: htmlBlob,
        filename: `DANFSe_${serie}_${numero}.html`,
        mimeType: 'text/html',
      },
    });
    return { email, resultado };
  }
}

/** Envia a DANFE direto via Resend, o mesmo caminho do boleto. Não abre Outlook/.eml. */
export async function enviarDanfePorEmailDireto(notaFiscalId: string): Promise<EmitirBoletoEmailResult> {
  const id = safeTrim(notaFiscalId);
  if (!id) throw new Error('Nota não identificada.');

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = nfeApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const res = await fetch(`${base}/api/nfe/artefatos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'enviar-email', notaFiscalId: id }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    email?: EmitirBoletoEmailResult;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.message ?? `Falha ao enviar e-mail (${res.status}).`);
  }

  return body.email ?? { skipped: true, reason: 'sem_resposta' };
}

function mensagemEmailNota(email: EmitirBoletoEmailResult): {
  type: 'success' | 'info' | 'error';
  text1: string;
  text2?: string;
} {
  if (email.enviado && email.to) {
    return {
      type: 'success',
      text1: 'NFS-e enviada por e-mail.',
      text2: `Destinatário: ${email.to}`,
    };
  }
  if (email.skipped) {
    const reason = email.reason ?? '';
    if (reason === 'sem_email_cadastro') {
      return {
        type: 'info',
        text1: 'Cliente sem e-mail no cadastro.',
        text2: 'Cadastre um contato tipo e-mail no cliente e tente de novo.',
      };
    }
    if (reason === 'sem_pdf') {
      return {
        type: 'info',
        text1: 'DANFE ainda indisponível.',
        text2: 'Abra a nota para gerar a DANFE e envie de novo.',
      };
    }
    if (reason === 'email_nao_configurado') {
      return {
        type: 'error',
        text1: 'Envio automático não configurado.',
        text2: 'Configure RESEND_API_KEY na Vercel e verifique o domínio no Resend.',
      };
    }
    return {
      type: 'info',
      text1: 'E-mail não enviado.',
      text2: reason || 'Não foi possível enviar agora.',
    };
  }
  return {
    type: 'error',
    text1: 'E-mail não enviado.',
    text2: email.error || 'Falha no Resend.',
  };
}

export async function compartilharDanfseComFeedback(item: NotaFiscalListRow): Promise<void> {
  const Toast = (await import('react-native-toast-message')).default;
  if (item.status !== 'autorizada') {
    throw new Error('Só é possível enviar por e-mail uma nota autorizada.');
  }
  await fetchDanfseHtml(item);
  const result = await enviarDanfePorEmailDireto(item.id);
  const msg = mensagemEmailNota(result);
  Toast.show({
    type: msg.type,
    text1: msg.text1,
    text2: msg.text2,
    visibilityTime: 8000,
  });
}
