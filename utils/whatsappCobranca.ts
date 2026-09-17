import type { ContaReceberListRow } from '@/types/contasReceber';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate } from '@/utils/date';
import { resolveBoletoPdfUrl } from '@/utils/openBoletoDocumento';
import { safeTrim } from '@/utils/safeTrim';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

export type EnvioWhatsappCobrancaResultado =
  | { modo: 'compartilhado' }
  | { modo: 'app_aberto' }
  | { modo: 'pdf_e_app' };

function isWeb(): boolean {
  return Platform.OS === 'web' || (typeof document !== 'undefined' && typeof window !== 'undefined');
}

/** Dígitos no formato internacional (ex.: 5519981111724). */
export function whatsappPhoneToInternational(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }

  if (digits.length === 11 || digits.length === 10) {
    return `55${digits}`;
  }

  if (digits.length > 11 && digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
    if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  }

  return digits.length >= 12 ? digits : null;
}

export function formatWhatsAppDisplay(raw: string): string {
  const intl = whatsappPhoneToInternational(raw);
  if (!intl || !intl.startsWith('55')) return raw.trim();
  const local = intl.slice(2);
  if (local.length === 11) {
    return `${local.slice(0, 2)} ${local.slice(2, 3)} ${local.slice(3, 7)}${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `${local.slice(0, 2)} ${local.slice(2, 6)}${local.slice(6)}`;
  }
  return raw.trim();
}

export function buildMensagemCobrancaWhatsapp(
  row: Pick<
    ContaReceberListRow,
    | 'nome_cliente'
    | 'referencia_label'
    | 'valor_documento'
    | 'data_vencimento'
    | 'numero_documento'
    | 'whatsapp'
    | 'linha_digitavel'
    | 'pix_copia_cola'
  >,
  opts?: { nomeBeneficiario?: string; incluirTelefone?: boolean; pdfUrl?: string | null },
): string {
  const venc = formatBRDate(parseISODate(row.data_vencimento)) || row.data_vencimento;
  const beneficiario = opts?.nomeBeneficiario?.trim();
  const tel =
    opts?.incluirTelefone && row.whatsapp
      ? formatWhatsAppDisplay(row.whatsapp)
      : null;
  const pdfUrl = safeTrim(opts?.pdfUrl);

  const linhas = [
    `Olá, ${row.nome_cliente.trim() || 'cliente'}!`,
    '',
    beneficiario ? `Aqui é da *${beneficiario}*.` : null,
    'Segue o boleto para pagamento:',
    `• ${row.referencia_label}`,
    `• Valor: *${formatBRL(row.valor_documento)}*`,
    `• Vencimento: *${venc}*`,
    row.numero_documento ? `• Documento: ${row.numero_documento}` : null,
    row.linha_digitavel ? `\n*Linha digitável do boleto:*\n${row.linha_digitavel}` : null,
    row.pix_copia_cola ? `\n*Pix Copia e Cola:*\n${row.pix_copia_cola}` : null,
    pdfUrl ? `\n*PDF do boleto:*\n${pdfUrl}` : null,
    '',
    'O boleto segue em anexo (ou no link acima).',
    'Qualquer dúvida, estamos à disposição.',
    'WhatsApp: (19) 98111-1724',
    'Obrigado!',
    tel ? `\n(Contato WhatsApp: ${tel})` : null,
  ].filter((l): l is string => l != null && l !== '');

  return linhas.join('\n');
}

/**
 * Link oficial wa.me — abre o chat do número (app ou WhatsApp Web).
 * O número deve ser internacional, só dígitos (ex.: 5519981111724).
 */
export function buildWhatsAppDeepLink(phoneInternational: string, message: string): string {
  const phone = phoneInternational.replace(/\D/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function resolveWhatsAppCobrancaUrl(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string; pdfUrl?: string | null },
): string {
  const raw = row.whatsapp?.trim();
  if (!raw) {
    throw new Error('Cadastre um contato WhatsApp no cliente.');
  }
  const phone = whatsappPhoneToInternational(raw);
  if (!phone) {
    throw new Error('Número de WhatsApp inválido no cadastro do cliente.');
  }
  const message = buildMensagemCobrancaWhatsapp(row, opts);
  return buildWhatsAppDeepLink(phone, message);
}

function abrirUrlWhatsApp(url: string): void {
  if (isWeb() && typeof window !== 'undefined') {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(url);
    }
    return;
  }
  void Linking.openURL(url).catch(() => {
    throw new Error('Não foi possível abrir o WhatsApp neste dispositivo.');
  });
}

/** Abre na hora do clique (texto apenas — preferir compartilharBoletoWhatsAppComPdf). */
export function abrirWhatsAppCobrancaNaConversa(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string; pdfUrl?: string | null },
): void {
  abrirUrlWhatsApp(resolveWhatsAppCobrancaUrl(row, opts));
}

async function fetchPdfBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Não foi possível baixar o PDF do boleto.');
  const blob = await res.blob();
  if (blob.type === 'application/pdf') return blob;
  return new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
}

async function htmlParaPdf(html: string): Promise<{ blob: Blob; uri: string }> {
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

function baixarPdfWeb(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function obterPdfBoleto(
  row: ContaReceberListRow,
): Promise<{ blob: Blob; uri?: string; pdfUrl: string | null }> {
  if (row.tipo_emissao === 'c6' && !row.linha_digitavel && !row.pdf_url) {
    throw new Error(
      safeTrim(row.mensagem_erro_registro) ||
        'Boleto C6 ainda não registrado. Use “Registrar no C6” antes de enviar.',
    );
  }

  const pdfUrl = await resolveBoletoPdfUrl(row);
  if (pdfUrl) {
    if (isWeb()) {
      const blob = await fetchPdfBlob(pdfUrl);
      return { blob, pdfUrl };
    }
    const FileSystem = await import('expo-file-system/legacy');
    const path = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}boleto_wa_${row.id}.pdf`;
    const dl = await FileSystem.downloadAsync(pdfUrl, path);
    const base64 = await FileSystem.readAsStringAsync(dl.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      uri: dl.uri,
      pdfUrl,
    };
  }

  const html = buildBoletoCobrancaHtml(row);
  const { blob, uri } = await htmlParaPdf(html);
  return { blob, uri, pdfUrl: null };
}

/**
 * Compartilha cobrança no WhatsApp com PDF do boleto.
 * 1) Tenta compartilhar arquivo + texto (share sheet — escolha WhatsApp)
 * 2) Senão baixa o PDF e abre o WhatsApp com a mensagem (e link do PDF se houver)
 */
export async function compartilharBoletoWhatsAppComPdf(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<EnvioWhatsappCobrancaResultado> {
  const raw = row.whatsapp?.trim();
  if (!raw) throw new Error('Cadastre um contato WhatsApp no cliente.');
  const phone = whatsappPhoneToInternational(raw);
  if (!phone) throw new Error('Número de WhatsApp inválido no cadastro do cliente.');

  const { blob, uri, pdfUrl } = await obterPdfBoleto(row);
  const filename = `boleto_${safeTrim(row.numero_documento) || row.id}.pdf`;
  const message = buildMensagemCobrancaWhatsapp(row, {
    nomeBeneficiario: opts?.nomeBeneficiario,
    pdfUrl,
  });

  if (isWeb() && typeof File !== 'undefined' && typeof navigator !== 'undefined' && navigator.share) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    const shareData: ShareData = { title: 'Boleto', text: message, files: [file] };
    if (navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return { modo: 'compartilhado' };
    }
  }

  if (!isWeb() && uri && (await Sharing.isAvailableAsync())) {
    try {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Enviar boleto no WhatsApp',
        UTI: 'com.adobe.pdf',
      });
      return { modo: 'compartilhado' };
    } catch {
      /* fallback wa.me */
    }
  }

  if (isWeb()) {
    baixarPdfWeb(blob, filename);
  }

  abrirUrlWhatsApp(buildWhatsAppDeepLink(phone, message));
  return { modo: 'pdf_e_app' };
}

export async function compartilharBoletoWhatsAppComFeedback(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<void> {
  const Toast = (await import('react-native-toast-message')).default;
  const result = await compartilharBoletoWhatsAppComPdf(row, opts);
  if (result.modo === 'compartilhado') {
    Toast.show({
      type: 'success',
      text1: 'Escolha o WhatsApp para enviar o boleto.',
      text2: 'A mensagem e o PDF vão juntos.',
    });
    return;
  }
  if (result.modo === 'pdf_e_app') {
    Toast.show({
      type: 'info',
      text1: 'PDF do boleto baixado.',
      text2: 'O WhatsApp abriu com a mensagem — anexe o PDF baixado se ainda não estiver junto.',
      visibilityTime: 9000,
    });
  }
}

/** Abre o WhatsApp já na conversa do cliente com a mensagem de cobrança. */
export async function enviarCobrancaWhatsapp(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<EnvioWhatsappCobrancaResultado> {
  return compartilharBoletoWhatsAppComPdf(row, opts);
}

/** @deprecated Use compartilharBoletoWhatsAppComPdf. */
export async function abrirWhatsAppAppCobranca(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<void> {
  await compartilharBoletoWhatsAppComPdf(row, opts);
}

/** @deprecated Use compartilharBoletoWhatsAppComPdf. */
export async function abrirWhatsAppCobranca(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<void> {
  await compartilharBoletoWhatsAppComPdf(row, opts);
}
