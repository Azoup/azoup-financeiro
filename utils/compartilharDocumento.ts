import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';
import { blobToBase64, buildEmlDraft, downloadEmlFile } from '@/utils/buildEmlDraft';
import { safeTrim } from '@/utils/safeTrim';

export type CompartilharResultado = 'email' | 'compartilhado' | 'eml';

function isWeb(): boolean {
  return Platform.OS === 'web' || (typeof document !== 'undefined' && typeof window !== 'undefined');
}

/** Normaliza texto para e-mail (sem +, com quebras Windows). */
export function normalizeEmailText(value: unknown): string {
  return safeTrim(value)
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\r\n');
}

/**
 * Outlook no Windows trata "+" do mailto como caractere literal.
 * Nunca use URLSearchParams — encodeURIComponent gera %20.
 */
export function buildMailtoUrl(opts: {
  to?: string | null;
  subject: string;
  body: string;
}): string {
  const to = safeTrim(opts.to);
  const subject = normalizeEmailText(opts.subject);
  const body = normalizeEmailText(opts.body);
  const parts: string[] = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  // encodeURIComponent já usa %20; reforço caso algum polyfill use +
  const qs = parts.join('&').replace(/\+/g, '%20');
  return qs ? `mailto:${to}?${qs}` : `mailto:${to}`;
}

export async function abrirEmail(opts: {
  to?: string | null;
  subject: string;
  body: string;
}): Promise<CompartilharResultado> {
  // No web, preferimos .eml (texto limpo) em vez de mailto (Outlook coloca +).
  if (isWeb()) {
    const eml = buildEmlDraft({
      to: opts.to,
      subject: normalizeEmailText(opts.subject),
      body: normalizeEmailText(opts.body),
    });
    downloadEmlFile('mensagem.eml', eml);
    return 'eml';
  }
  const url = buildMailtoUrl(opts);
  const can = await Linking.canOpenURL(url);
  if (!can) {
    throw new Error('Não foi possível abrir o app de e-mail neste dispositivo.');
  }
  await Linking.openURL(url);
  return 'email';
}

async function compartilharArquivoNativo(opts: {
  uri: string;
  filename: string;
  mimeType: string;
}): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(opts.uri, {
    mimeType: opts.mimeType,
    dialogTitle: opts.filename,
  });
  return true;
}

async function baixarArquivoWeb(blob: Blob, filename: string): Promise<void> {
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
 * Preferências no web (em ordem):
 * 1) Web Share com arquivo (quando o browser permite)
 * 2) .eml com anexo (Outlook abre rascunho com PDF anexado e texto limpo)
 * Nunca usa mailto no web (evita texto com "+").
 */
export async function compartilharComEmail(opts: {
  to?: string | null;
  subject: string;
  body: string;
  arquivo?: { uri?: string; blob?: Blob; filename: string; mimeType: string };
  preferirShareSheet?: boolean;
}): Promise<CompartilharResultado> {
  const preferirShare = opts.preferirShareSheet !== false;
  const subject = normalizeEmailText(opts.subject);
  const body = normalizeEmailText(opts.body);

  if (isWeb() && opts.arquivo?.blob && typeof File !== 'undefined') {
    const file = new File([opts.arquivo.blob], opts.arquivo.filename, {
      type: opts.arquivo.mimeType,
    });
    const shareData: ShareData = { title: subject, text: body, files: [file] };
    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return 'compartilhado';
    }

    const contentBase64 = await blobToBase64(opts.arquivo.blob);
    const eml = buildEmlDraft({
      to: opts.to,
      subject,
      body,
      attachments: [
        {
          filename: opts.arquivo.filename,
          mimeType: opts.arquivo.mimeType,
          contentBase64,
        },
      ],
    });
    const emlName = opts.arquivo.filename.replace(/\.[^.]+$/, '') || 'documento';
    downloadEmlFile(`${emlName}.eml`, eml);
    await baixarArquivoWeb(opts.arquivo.blob, opts.arquivo.filename);
    return 'eml';
  }

  if (preferirShare && opts.arquivo?.uri && !isWeb()) {
    try {
      const ok = await compartilharArquivoNativo({
        uri: opts.arquivo.uri,
        filename: opts.arquivo.filename,
        mimeType: opts.arquivo.mimeType,
      });
      if (ok) return 'compartilhado';
    } catch {
      /* fallback */
    }
  }

  return abrirEmail({ to: opts.to, subject, body });
}
