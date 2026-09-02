import { fetchEmailCliente } from '@/services/clienteContatoService';
import type { ContaReceberListRow } from '@/types/contasReceber';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import {
  compartilharComEmail,
  type CompartilharResultado,
} from '@/utils/compartilharDocumento';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate } from '@/utils/date';
import { resolveBoletoPdfUrl } from '@/utils/openBoletoDocumento';
import { safeTrim } from '@/utils/safeTrim';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

function isWeb(): boolean {
  return Platform.OS === 'web' || (typeof document !== 'undefined' && typeof window !== 'undefined');
}

export function buildCorpoEmailBoleto(row: ContaReceberListRow): string {
  const venc = formatBRDate(parseISODate(row.data_vencimento)) || row.data_vencimento;
  const linhas = [
    `Olá, ${safeTrim(row.nome_cliente) || 'cliente'}!`,
    '',
    'Segue o boleto para pagamento:',
    `• ${safeTrim(row.referencia_label) || 'Cobrança'}`,
    `• Valor: ${formatBRL(row.valor_documento)}`,
    `• Vencimento: ${venc}`,
    row.numero_documento ? `• Documento: ${safeTrim(row.numero_documento)}` : null,
    row.linha_digitavel ? `\nLinha digitável:\n${safeTrim(row.linha_digitavel)}` : null,
    row.pix_copia_cola ? `\nPix Copia e Cola:\n${safeTrim(row.pix_copia_cola)}` : null,
    '',
    'O boleto segue em anexo.',
    '',
    'Qualquer dúvida, estamos à disposição.',
    'Atenciosamente.',
  ].filter((l): l is string => l != null);
  return linhas.join('\n');
}

async function fetchPdfBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Não foi possível baixar o PDF do boleto.');
  const blob = await res.blob();
  if (blob.type === 'application/pdf') return blob;
  return new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
}

async function htmlParaPdfBlob(html: string): Promise<{ blob: Blob; uri?: string }> {
  const { uri } = await Print.printToFileAsync({ html });
  if (isWeb() && typeof fetch !== 'undefined') {
    const res = await fetch(uri);
    const blob = await res.blob();
    const pdfBlob =
      blob.type === 'application/pdf'
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
    return { blob: pdfBlob, uri };
  }
  const FileSystem = await import('expo-file-system/legacy');
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: 'application/pdf' }), uri };
}

export async function compartilharBoletoPorEmail(row: ContaReceberListRow): Promise<{
  email: string | null;
  resultado: CompartilharResultado;
}> {
  if (!row.cliente_id) {
    throw new Error('Cliente não identificado para este boleto.');
  }
  const email = await fetchEmailCliente(row.cliente_id);
  const pdfUrl = await resolveBoletoPdfUrl(row);
  const subject = `Boleto — ${safeTrim(row.referencia_label) || 'cobrança'}`;
  const body = buildCorpoEmailBoleto(row);
  const filename = `boleto_${safeTrim(row.numero_documento) || row.id}.pdf`;

  if (pdfUrl) {
    if (isWeb()) {
      const blob = await fetchPdfBlob(pdfUrl);
      const resultado = await compartilharComEmail({
        to: email,
        subject,
        body,
        arquivo: { blob, filename, mimeType: 'application/pdf' },
      });
      return { email, resultado };
    }

    const FileSystem = await import('expo-file-system/legacy');
    const path = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}boleto_${row.id}.pdf`;
    const dl = await FileSystem.downloadAsync(pdfUrl, path);
    const resultado = await compartilharComEmail({
      to: email,
      subject,
      body,
      arquivo: {
        uri: dl.uri,
        filename,
        mimeType: 'application/pdf',
      },
    });
    return { email, resultado };
  }

  if (row.tipo_emissao === 'c6' && !row.linha_digitavel) {
    throw new Error(
      safeTrim(row.mensagem_erro_registro) ||
        'Boleto C6 ainda não registrado. Use “Registrar no C6” antes de compartilhar.',
    );
  }

  const html = buildBoletoCobrancaHtml(row);
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
}

export async function compartilharBoletoComFeedback(row: ContaReceberListRow): Promise<void> {
  const { email, resultado } = await compartilharBoletoPorEmail(row);
  const Toast = (await import('react-native-toast-message')).default;
  if (resultado === 'eml') {
    Toast.show({
      type: 'success',
      text1: 'E-mail com boleto em anexo baixado.',
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
