import type { ContaReceberListRow } from '@/types/contasReceber';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import { mensagemPendenciaBoleto } from '@/utils/mensagemPendenciaBoleto';
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
  row: Pick<ContaReceberListRow, 'data_vencimento'>,
): string {
  return mensagemPendenciaBoleto(row.data_vencimento);
}

/** Texto da cobrança + link do PDF (wa.me não anexa arquivo; o link leva o boleto junto). */
export function buildMensagemCobrancaWhatsappComPdf(
  row: Pick<ContaReceberListRow, 'data_vencimento'>,
  pdfUrl?: string | null,
): string {
  const base = buildMensagemCobrancaWhatsapp(row);
  const url = safeTrim(pdfUrl);
  if (!url) return base;
  return `${base}\n\n📄 Boleto em PDF:\n${url}`;
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
  const message = buildMensagemCobrancaWhatsappComPdf(row, opts?.pdfUrl);
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

/** Abre na hora do clique (texto + link do PDF quando houver). */
export function abrirWhatsAppCobrancaNaConversa(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string; pdfUrl?: string | null },
): void {
  abrirUrlWhatsApp(resolveWhatsAppCobrancaUrl(row, opts));
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

async function fetchPdfBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Não foi possível baixar o PDF do boleto.');
  const blob = await res.blob();
  if (blob.size < 64) throw new Error('PDF do boleto veio vazio. Abra o boleto e tente de novo.');
  if (blob.type === 'application/pdf') return blob;
  return new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
}

/** Garante URL assinada quando só temos o blob (carnê HTML) para colocar no wa.me. */
async function publicarPdfTemporario(
  row: ContaReceberListRow,
  blob: Blob,
): Promise<string | null> {
  try {
    const { supabase } = await import('@/lib/supabase');
    const bucket = row.tipo_emissao === 'c6' ? 'boletos_c6' : 'boletos_sicoob';
    const path = `${row.user_id}/whatsapp/${row.id}.pdf`;
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      upsert: true,
      contentType: 'application/pdf',
      cacheControl: '3600',
    });
    if (error) return null;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
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

  // Vencimento editado no sistema pode deixar o PDF do Storage com a data antiga.
  let rowPdf = row;
  if (
    (row.tipo_emissao === 'sicoob' && row.nosso_numero_banco) ||
    (row.tipo_emissao === 'c6' && row.c6_boleto_id)
  ) {
    try {
      const { atualizarPdfOficialBoleto } = await import('@/services/sicoobBoletoService');
      const refreshed = await atualizarPdfOficialBoleto(row.id);
      if (refreshed.pdf_url) {
        rowPdf = { ...row, pdf_url: refreshed.pdf_url };
      }
    } catch {
      /* segue com o PDF já gravado */
    }
  }

  const pdfUrl = await resolveBoletoPdfUrl(rowPdf);
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
  const published = await publicarPdfTemporario(row, blob);
  return { blob, uri, pdfUrl: published };
}

/**
 * O WhatsApp NÃO anexa PDF por link (wa.me). Só pelo compartilhar do SO
 * (Windows/Android/iOS) escolhendo o app WhatsApp — aí o arquivo vai como documento.
 * Não usa canShare para barrar: em alguns Chromes ele mente e o share funciona.
 */
async function compartilharPdf(file: File, legenda?: string): Promise<'ok' | 'cancelado' | 'indisponivel'> {
  if (!isWeb() || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'indisponivel';
  }
  if (file.size < 64) return 'indisponivel';

  const text = safeTrim(legenda);
  const payloads: ShareData[] = text
    ? [
        { files: [file], title: 'Boleto', text },
        { files: [file], text },
        { files: [file] },
      ]
    : [{ files: [file], title: 'Boleto' }, { files: [file] }];

  let sawAbort = false;
  for (const data of payloads) {
    try {
      await navigator.share(data);
      return 'ok';
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') {
        sawAbort = true;
        break;
      }
    }
  }
  return sawAbort ? 'cancelado' : 'indisponivel';
}

/**
 * Abre o app WhatsApp na conversa (texto), sem navegar a aba do Azoup
 * e sem abrir WhatsApp Web / api.whatsapp.com.
 */
function abrirWhatsAppDesktopProtocol(phone: string, message: string): void {
  if (!isWeb() || typeof document === 'undefined') return;
  const digits = phone.replace(/\D/g, '');
  const appUrl = `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`;
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = appUrl;
  document.body.appendChild(iframe);
  setTimeout(() => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  }, 2500);
}

async function gravarBlobNativo(blob: Blob, rowId: string): Promise<string> {
  const FileSystem = await import('expo-file-system/legacy');
  const path = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}boleto_wa_${rowId}.pdf`;
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const base64 = btoa(binary);
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

/**
 * Compartilha cobrança no WhatsApp com o PDF como documento anexado
 * (como na conversa: texto + arquivo PDF), nunca só link e nunca download no lugar do anexo.
 */
export async function compartilharBoletoWhatsAppComPdf(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<EnvioWhatsappCobrancaResultado | { modo: 'cancelado' }> {
  const raw = row.whatsapp?.trim();
  if (!raw) throw new Error('Cadastre um contato WhatsApp no cliente.');
  const phone = whatsappPhoneToInternational(raw);
  if (!phone) throw new Error('Número de WhatsApp inválido no cadastro do cliente.');

  const { blob, uri: uriInicial } = await obterPdfBoleto(row);
  const filename = `boleto_${safeTrim(row.numero_documento) || row.id}.pdf`;
  // Sem URL do PDF na mensagem — o arquivo vai pelo compartilhar, não como link.
  const message = buildMensagemCobrancaWhatsapp(row);

  if (!isWeb()) {
    let uri = uriInicial;
    if (!uri) {
      try {
        uri = await gravarBlobNativo(blob, row.id);
      } catch {
        uri = undefined;
      }
    }
    if (uri && (await Sharing.isAvailableAsync())) {
      try {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Enviar boleto no WhatsApp',
          UTI: 'com.adobe.pdf',
        });
        return { modo: 'compartilhado' };
      } catch {
        /* fallback */
      }
    }
    await Linking.openURL(`whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`);
    return { modo: 'pdf_e_app' };
  }

  if (typeof File === 'undefined' || typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    throw new Error(
      'Este navegador não anexa PDF no WhatsApp. Use Chrome ou Edge no Windows, com o WhatsApp Desktop instalado.',
    );
  }

  const pdfBlob =
    blob.type === 'application/pdf' ? blob : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
  const file = new File([pdfBlob], filename, {
    type: 'application/pdf',
    lastModified: Date.now(),
  });

  // O await do PDF perde o gesto do clique; o OK renova e libera o share com arquivo.
  const seguir = window.confirm(
    'PDF pronto.\n\n1) Clique em OK\n2) Na lista do Windows, escolha o WhatsApp instalado (não o Web)\n3) Selecione o contato — o boleto vai como documento anexado.',
  );
  if (!seguir) return { modo: 'cancelado' };

  // 1) Tenta texto + PDF juntos (documento anexado na conversa).
  let compartilhou = await compartilharPdf(file, message);
  if (compartilhou === 'ok') return { modo: 'compartilhado' };
  if (compartilhou === 'cancelado') return { modo: 'cancelado' };

  // 2) Só o arquivo; em seguida abre a conversa com o texto (sem link).
  compartilhou = await compartilharPdf(file);
  if (compartilhou === 'ok') {
    abrirWhatsAppDesktopProtocol(phone, message);
    return { modo: 'compartilhado' };
  }
  if (compartilhou === 'cancelado') return { modo: 'cancelado' };

  throw new Error(
    'Não foi possível anexar o PDF. Use Chrome/Edge, confirme o compartilhar do Windows e escolha o app WhatsApp (ícone verde), não o WhatsApp Web.',
  );
}

export async function compartilharBoletoWhatsAppComFeedback(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string },
): Promise<void> {
  const Toast = (await import('react-native-toast-message')).default;
  const result = await compartilharBoletoWhatsAppComPdf(row, opts);
  if (result.modo === 'cancelado') return;
  if (result.modo === 'compartilhado') {
    Toast.show({
      type: 'success',
      text1: 'PDF pronto para anexar no WhatsApp',
      text2: 'Escolha o WhatsApp instalado na lista — o arquivo vai como documento, não como link.',
    });
    return;
  }
  if (result.modo === 'pdf_e_app') {
    Toast.show({
      type: 'info',
      text1: 'WhatsApp aberto com a mensagem.',
      text2: 'Anexe o PDF pela conversa se o documento não aparecer.',
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
