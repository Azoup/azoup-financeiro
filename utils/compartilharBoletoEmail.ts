import { fetchEmailCliente } from '@/services/clienteContatoService';
import type { ContaReceberListRow } from '@/types/contasReceber';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import { compartilharComEmail } from '@/utils/compartilharDocumento';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate } from '@/utils/date';
import { resolveBoletoPdfUrl } from '@/utils/openBoletoDocumento';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

export function buildCorpoEmailBoleto(
  row: ContaReceberListRow,
  opts?: { pdfLink?: string | null },
): string {
  const venc = formatBRDate(parseISODate(row.data_vencimento)) || row.data_vencimento;
  const linhas = [
    `Olá, ${row.nome_cliente.trim() || 'cliente'}!`,
    '',
    'Segue o boleto para pagamento:',
    `• ${row.referencia_label}`,
    `• Valor: ${formatBRL(row.valor_documento)}`,
    `• Vencimento: ${venc}`,
    row.numero_documento ? `• Documento: ${row.numero_documento}` : null,
    row.linha_digitavel ? `\nLinha digitável:\n${row.linha_digitavel}` : null,
    row.pix_copia_cola ? `\nPix Copia e Cola:\n${row.pix_copia_cola}` : null,
    opts?.pdfLink ? `\nPDF do boleto: ${opts.pdfLink}` : null,
    '',
    'Qualquer dúvida, estamos à disposição.',
    'Atenciosamente.',
  ].filter((l): l is string => l != null);
  return linhas.join('\n');
}

function abrirHtmlBoletoWeb(html: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function compartilharBoletoPorEmail(row: ContaReceberListRow): Promise<{
  email: string | null;
  resultado: 'email' | 'compartilhado';
}> {
  if (!row.cliente_id) {
    throw new Error('Cliente não identificado para este boleto.');
  }
  const email = await fetchEmailCliente(row.cliente_id);
  const pdfUrl = await resolveBoletoPdfUrl(row);
  const subject = `Boleto — ${row.referencia_label}`;
  const body = buildCorpoEmailBoleto(row, { pdfLink: pdfUrl });

  if (pdfUrl) {
    if (Platform.OS === 'web') {
      const resultado = await compartilharComEmail({
        to: email,
        subject,
        body,
        preferirShareSheet: false,
      });
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
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
        filename: `boleto_${row.numero_documento || row.id}.pdf`,
        mimeType: 'application/pdf',
      },
    });
    return { email, resultado };
  }

  if (row.tipo_emissao === 'c6' && !row.linha_digitavel) {
    throw new Error(
      row.mensagem_erro_registro?.trim() ||
        'Boleto C6 ainda não registrado. Use “Registrar no C6” antes de compartilhar.',
    );
  }

  const html = buildBoletoCobrancaHtml(row);

  if (Platform.OS === 'web') {
    const resultado = await compartilharComEmail({
      to: email,
      subject,
      body,
      preferirShareSheet: false,
    });
    abrirHtmlBoletoWeb(html);
    return { email, resultado };
  }

  const { uri } = await Print.printToFileAsync({ html });
  const resultado = await compartilharComEmail({
    to: email,
    subject,
    body,
    arquivo: {
      uri,
      filename: `boleto_${row.numero_documento || row.id}.pdf`,
      mimeType: 'application/pdf',
    },
  });
  return { email, resultado };
}

export async function compartilharBoletoComFeedback(row: ContaReceberListRow): Promise<void> {
  const { email, resultado } = await compartilharBoletoPorEmail(row);
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
