import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import { formatBRL } from '@/utils/currency';
import { buildDanfseHtmlFromNota } from '@/utils/danfseHtml';
import { fetchEmailCliente } from '@/services/clienteContatoService';
import { compartilharComEmail } from '@/utils/compartilharDocumento';
import { safeTrim } from '@/utils/safeTrim';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

function isWeb(): boolean {
  return Platform.OS === 'web' || (typeof document !== 'undefined' && typeof window !== 'undefined');
}

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

export function buildCorpoEmailDanfse(
  item: NotaFiscalListRow,
  opts?: { pdfLink?: string | null },
): string {
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
    opts?.pdfLink
      ? `Documento (DANFSe): ${safeTrim(opts.pdfLink)}`
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
  // Popup bloqueado: navega na mesma aba
  window.location.assign(url);
}

export async function compartilharDanfsePorEmail(item: NotaFiscalListRow): Promise<{
  email: string | null;
  resultado: 'email' | 'compartilhado';
}> {
  const email = await fetchEmailCliente(item.cliente_id);
  const { html, danfeUrl } = await fetchDanfseHtml(item);
  const serie = safeTrim(item.serie) || '1';
  const numero = safeTrim(item.numero) || 's_numero';
  const subject = `NFS-e ${serie}/${numero}`;
  // No web o Storage costuma servir .html como text/plain; o cliente abre a DANFSe
  // renderizada via blob. O link público só entra no e-mail se existir.
  const body = buildCorpoEmailDanfse(item, {
    pdfLink: isWeb() ? null : danfeUrl,
  });

  if (isWeb()) {
    // Abre a DANFSe renderizada (blob text/html) — nunca a URL do Storage em bruto.
    abrirHtmlDanfseWeb(html);
    const resultado = await compartilharComEmail({
      to: email,
      subject,
      body:
        body +
        '\n\n(A DANFSe foi aberta em outra aba: use Imprimir / Salvar como PDF e anexe ao e-mail.)',
      preferirShareSheet: false,
    });
    return { email, resultado };
  }

  const { uri } = await Print.printToFileAsync({ html });
  const resultado = await compartilharComEmail({
    to: email,
    subject,
    body,
    arquivo: {
      uri,
      filename: `DANFSe_${serie}_${numero}.pdf`,
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
      text2: isWeb()
        ? 'DANFSe aberta em outra aba. Cadastre o e-mail ou preencha o destinatário.'
        : 'Preencha o destinatário no app de e-mail ou cadastre em Contatos do cliente.',
    });
  } else if (resultado === 'email') {
    Toast.show({
      type: 'success',
      text1: 'E-mail aberto.',
      text2: isWeb()
        ? `Destinatário: ${email}. Na aba da DANFSe use Imprimir → Salvar PDF e anexe.`
        : `Destinatário sugerido: ${email}`,
    });
  } else {
    Toast.show({ type: 'success', text1: 'Compartilhamento iniciado.' });
  }
}
