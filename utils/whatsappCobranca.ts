import type { ContaReceberListRow } from '@/types/contasReceber';
import { buildBoletoCobrancaHtml } from '@/utils/boletoCobrancaHtml';
import { calcularEncargosBoleto } from '@/utils/boletoEncargos';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, parseISODate } from '@/utils/date';
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

/**
 * WhatsApp:
 * - Em aberto (vencimento ainda não passou) → “Segue o boleto…” com os campos do boleto.
 * - Atrasado → texto amigável de pendência (“Olá! Tudo bem?…”).
 */
export function buildMensagemCobrancaWhatsapp(
  row: Pick<
    ContaReceberListRow,
    | 'data_vencimento'
    | 'nome_cliente'
    | 'referencia_label'
    | 'valor_documento'
    | 'numero_documento'
    | 'linha_digitavel'
    | 'pix_copia_cola'
    | 'beneficiario_razao_social'
  >,
  opts?: { nomeBeneficiario?: string },
): string {
  const encargos = calcularEncargosBoleto(row.valor_documento, row.data_vencimento);

  // Atrasado: texto amigável de pendência.
  if (encargos.vencido) {
    return mensagemPendenciaBoleto(row.data_vencimento);
  }

  // Em aberto: “Segue o boleto…” com os campos (multa/juros zerados enquanto no prazo).
  const venc = formatBRDate(parseISODate(row.data_vencimento)) || row.data_vencimento;
  const cliente = safeTrim(row.nome_cliente) || 'cliente';
  const beneficiario =
    safeTrim(opts?.nomeBeneficiario) || safeTrim(row.beneficiario_razao_social) || 'Azoup Tecnologia LTDA';
  const linhas = [
    `Olá, ${cliente}!`,
    `Aqui é da ${beneficiario}.`,
    'Segue o boleto para pagamento:',
    safeTrim(row.referencia_label) || 'Mensalidade recorrente',
    `Valor original: ${formatBRL(row.valor_documento)}`,
    `Multa (2%): ${formatBRL(encargos.multa)}`,
    `Juros (0,033% ao dia × ${encargos.dias} dia(s)): ${formatBRL(encargos.juros)}`,
    `Valor para pagamento hoje: ${formatBRL(encargos.total)}`,
    `Vencimento: ${venc}`,
    row.numero_documento ? `Documento: ${safeTrim(row.numero_documento)}` : null,
    row.linha_digitavel ? `\nLinha digitável do boleto:\n${safeTrim(row.linha_digitavel)}` : null,
    row.pix_copia_cola ? `\nPix Copia e Cola:\n${safeTrim(row.pix_copia_cola)}` : null,
    'O boleto segue em anexo.',
    'Qualquer dúvida, estamos à disposição.',
    'WhatsApp: (19) 98111-1724',
    'Obrigado!',
  ].filter((l): l is string => l != null && l !== '');

  return linhas.join('\n');
}

/** Texto da cobrança + link do PDF (wa.me não anexa arquivo; o link leva o boleto junto). */
export function buildMensagemCobrancaWhatsappComPdf(
  row: ContaReceberListRow,
  opts?: { nomeBeneficiario?: string; pdfUrl?: string | null },
): string {
  const base = buildMensagemCobrancaWhatsapp(row, opts);
  const url = safeTrim(opts?.pdfUrl);
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
  const message = buildMensagemCobrancaWhatsappComPdf(row, {
    nomeBeneficiario: opts?.nomeBeneficiario,
    pdfUrl: opts?.pdfUrl,
  });
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

/**
 * O WhatsApp NÃO anexa PDF por link (wa.me). Só pelo compartilhar do SO
 * escolhendo o app WhatsApp — aí o arquivo vai como documento.
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
 * Modal com botão: o clique é o gesto do usuário que o Chrome exige
 * para abrir o compartilhar do Windows com o arquivo.
 */
function pedirCliqueParaCompartilharPdf(
  file: File,
  legenda: string,
): Promise<'ok' | 'cancelado' | 'indisponivel'> {
  if (typeof document === 'undefined') return Promise.resolve('indisponivel');

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif';

    const box = document.createElement('div');
    box.style.cssText =
      'background:#fff;max-width:420px;width:100%;border-radius:12px;padding:20px 22px;box-shadow:0 20px 50px rgba(0,0,0,.25)';

    const title = document.createElement('div');
    title.textContent = 'Enviar boleto no WhatsApp';
    title.style.cssText = 'font-size:17px;font-weight:700;color:#0f172a;margin-bottom:8px';

    const body = document.createElement('p');
    body.textContent =
      'Clique no botão verde. Na lista do Windows, escolha o WhatsApp instalado (ícone verde) — o PDF vai como documento anexado.';
    body.style.cssText = 'font-size:14px;line-height:1.45;color:#334155;margin:0 0 16px';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.style.cssText =
      'border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:10px 14px;font-size:14px;cursor:pointer';

    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = 'Anexar PDF no WhatsApp';
    send.style.cssText =
      'border:0;background:#16a34a;color:#fff;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer';

    const fechar = (result: 'ok' | 'cancelado' | 'indisponivel') => {
      try {
        overlay.remove();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    cancel.onclick = () => fechar('cancelado');
    send.onclick = () => {
      void (async () => {
        send.disabled = true;
        send.textContent = 'Abrindo…';
        const r = await compartilharPdf(file, legenda);
        if (r === 'indisponivel') {
          const soArquivo = await compartilharPdf(file);
          fechar(soArquivo);
          return;
        }
        fechar(r);
      })();
    };

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) fechar('cancelado');
    });

    row.appendChild(cancel);
    row.appendChild(send);
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    send.focus();
  });
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
  const message = buildMensagemCobrancaWhatsapp(row, opts);

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

  const pdfBlob =
    blob.type === 'application/pdf' ? blob : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' });
  const file =
    typeof File !== 'undefined'
      ? new File([pdfBlob], filename, { type: 'application/pdf', lastModified: Date.now() })
      : null;

  // Clique real no botão do modal = gesto válido para o compartilhar com arquivo.
  if (file && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const compartilhou = await pedirCliqueParaCompartilharPdf(file, message);
    if (compartilhou === 'ok') return { modo: 'compartilhado' };
    if (compartilhou === 'cancelado') return { modo: 'cancelado' };
  }

  // Fallback: abre a conversa no app + baixa o PDF para arrastar/anexar na conversa.
  baixarPdfWeb(pdfBlob, filename);
  abrirWhatsAppDesktopProtocol(phone, message);
  return { modo: 'pdf_e_app' };
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
      text1: 'WhatsApp aberto e PDF baixado.',
      text2: 'Na conversa, clique no clipe e anexe o boleto que acabou de baixar (ou arraste o arquivo).',
      visibilityTime: 12000,
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
