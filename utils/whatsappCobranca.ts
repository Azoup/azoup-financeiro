import type { ContaReceberListRow } from '@/types/contasReceber';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate } from '@/utils/date';
import { Linking, Platform } from 'react-native';

export type EnvioWhatsappCobrancaResultado =
  | { modo: 'copiado' }
  | { modo: 'compartilhado' }
  | { modo: 'app_aberto' };

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
    'nome_cliente' | 'referencia_label' | 'valor_documento' | 'data_vencimento' | 'numero_documento'
  >,
  opts?: { nomeBeneficiario?: string; incluirTelefone?: boolean },
): string {
  const venc = formatBRDate(parseISODate(row.data_vencimento)) || row.data_vencimento;
  const beneficiario = opts?.nomeBeneficiario?.trim();
  const tel =
    opts?.incluirTelefone && row.whatsapp
      ? formatWhatsAppDisplay(row.whatsapp)
      : null;

  const linhas = [
    `Olá, ${row.nome_cliente.trim() || 'cliente'}!`,
    '',
    beneficiario ? `Aqui é da *${beneficiario}*.` : null,
    'Segue lembrete de cobrança:',
    `• ${row.referencia_label}`,
    `• Valor: *${formatBRL(row.valor_documento)}*`,
    `• Vencimento: *${venc}*`,
    row.numero_documento ? `• Documento: ${row.numero_documento}` : null,
    '',
    'Por favor, confirme o pagamento ou entre em contato em caso de dúvidas.',
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
  opts?: { nomeBeneficiario?: string },
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

/** Abre na hora do clique (evita bloqueio de pop-up e perda do número na web). */
export function abrirWhatsAppCobrancaNaConversa(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): void {
  const url = resolveWhatsAppCobrancaUrl(row, opts);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
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

/** Abre o WhatsApp já na conversa do cliente com a mensagem de cobrança. */
export async function enviarCobrancaWhatsapp(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<EnvioWhatsappCobrancaResultado> {
  abrirWhatsAppCobrancaNaConversa(row, opts);
  return { modo: 'app_aberto' };
}

/** @deprecated Use abrirWhatsAppCobrancaNaConversa. */
export async function abrirWhatsAppAppCobranca(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<void> {
  abrirWhatsAppCobrancaNaConversa(row, opts);
}

/** @deprecated Use enviarCobrancaWhatsapp (não abre o app) ou abrirWhatsAppAppCobranca. */
export async function abrirWhatsAppCobranca(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<void> {
  await abrirWhatsAppAppCobranca(row, opts);
}
