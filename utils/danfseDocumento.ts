import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import { formatBRL } from '@/utils/currency';
import { buildDanfseHtmlFromNota } from '@/utils/danfseHtml';
import { fetchEmailCliente } from '@/services/clienteContatoService';
import { compartilharComEmail } from '@/utils/compartilharDocumento';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

export async function fetchDanfseHtml(item: NotaFiscalListRow): Promise<{
  html: string;
  danfeUrl: string | null;
}> {
  let htmlApi: string | null = null;
  let danfeUrl: string | null = item.danfe_url ?? null;
  const base = nfeApiBaseUrl();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;

  if (item.status === 'autorizada' && base && token) {
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
    };
    if (typeof body.html === 'string' && body.html.includes('<html')) {
      htmlApi = body.html;
    }
    if (body.danfe_url) danfeUrl = body.danfe_url;
  }

  const html = htmlApi || buildDanfseHtmlFromNota(item);
  return { html, danfeUrl };
}

export function buildCorpoEmailDanfse(
  item: NotaFiscalListRow,
  opts?: { pdfLink?: string | null },
): string {
  const nome = item.cliente?.nome_cliente ?? 'cliente';
  const linhas = [
    `Olá, ${nome}!`,
    '',
    'Segue a NFS-e referente ao serviço prestado:',
    `• Nota: ${item.serie}/${item.numero}`,
    `• Valor: ${formatBRL(item.valor_total)}`,
    item.competencia ? `• Competência: ${item.competencia}` : null,
    item.codigo_verificacao ? `• Código de verificação: ${item.codigo_verificacao}` : null,
    '',
    opts?.pdfLink
      ? `Documento (DANFSe): ${opts.pdfLink}`
      : 'O documento DANFSe segue em anexo (ou abra pelo link se disponível).',
    '',
    'Qualquer dúvida, estamos à disposição.',
    'Atenciosamente.',
  ].filter((l): l is string => l != null);
  return linhas.join('\n');
}

function abrirHtmlDanfseWeb(html: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (w) {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  URL.revokeObjectURL(url);
}

export async function compartilharDanfsePorEmail(item: NotaFiscalListRow): Promise<{
  email: string | null;
  resultado: 'email' | 'compartilhado';
}> {
  const email = await fetchEmailCliente(item.cliente_id);
  const { html, danfeUrl } = await fetchDanfseHtml(item);
  const subject = `NFS-e ${item.serie}/${item.numero}`;
  const body = buildCorpoEmailDanfse(item, { pdfLink: danfeUrl });

  if (Platform.OS === 'web') {
    const resultado = await compartilharComEmail({
      to: email,
      subject,
      body,
      preferirShareSheet: false,
    });
    if (danfeUrl && typeof window !== 'undefined') {
      window.open(danfeUrl, '_blank', 'noopener,noreferrer');
    } else {
      abrirHtmlDanfseWeb(html);
    }
    return { email, resultado };
  }

  const { uri } = await Print.printToFileAsync({ html });
  const resultado = await compartilharComEmail({
    to: email,
    subject,
    body,
    arquivo: {
      uri,
      filename: `DANFSe_${item.serie}_${item.numero}.pdf`,
      mimeType: 'application/pdf',
    },
  });
  return { email, resultado };
}

export async function compartilharDanfseComFeedback(item: NotaFiscalListRow): Promise<void> {
  const { email, resultado } = await compartilharDanfsePorEmail(item);
  const Toast = (await import('react-native-toast-message')).default;
  if (!email) {
    Toast.show({
      type: 'info',
      text1: 'E-mail do cliente não cadastrado.',
      text2: 'Preencha o destinatário no app de e-mail ou cadastre em Contatos do cliente.',
    });
  } else if (resultado === 'email') {
    Toast.show({
      type: 'success',
      text1: 'E-mail aberto.',
      text2: `Destinatário sugerido: ${email}`,
    });
  } else {
    Toast.show({ type: 'success', text1: 'Compartilhamento iniciado.' });
  }
}
