import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import type { NotaFiscalListRow } from '@/types/notaFiscal';
import { formatBRL } from '@/utils/currency';
import { buildDanfseHtmlFromNota } from '@/utils/danfseHtml';
import { fetchEmailCliente } from '@/services/clienteContatoService';
import { compartilharComEmail, type CompartilharResultado } from '@/utils/compartilharDocumento';
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

async function htmlParaPdfBlob(html: string): Promise<{ blob: Blob; uri?: string }> {
  const { uri } = await Print.printToFileAsync({ html });
  if (isWeb() && typeof fetch !== 'undefined') {
    const res = await fetch(uri);
    const blob = await res.blob();
    // Garante MIME de PDF mesmo se o browser devolver octet-stream
    const pdfBlob =
      blob.type === 'application/pdf'
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
    return { blob: pdfBlob, uri };
  }
  // Native: lê arquivo gerado pelo expo-print
  const FileSystem = await import('expo-file-system/legacy');
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: 'application/pdf' }), uri };
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
    const { blob, uri } = await htmlParaPdfBlob(html);
    const resultado = await compartilharComEmail({
      to: email,
      subject,
      body,
      arquivo: {
        uri,
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

export async function compartilharDanfseComFeedback(item: NotaFiscalListRow): Promise<void> {
  const { email, resultado } = await compartilharDanfsePorEmail(item);
  const Toast = (await import('react-native-toast-message')).default;
  if (resultado === 'eml') {
    Toast.show({
      type: 'success',
      text1: 'E-mail com DANFSe em anexo baixado.',
      text2: email
        ? `Abra o arquivo .eml no Outlook (para ${email}) e clique em Enviar.`
        : 'Abra o arquivo .eml no Outlook, confira o destinatário e envie.',
    });
    return;
  }
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
    Toast.show({ type: 'success', text1: 'Compartilhamento iniciado com anexo.' });
  }
}
