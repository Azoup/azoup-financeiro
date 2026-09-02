import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';
import { blobToBase64, buildEmlDraft, downloadEmlFile } from '@/utils/buildEmlDraft';
import { safeTrim } from '@/utils/safeTrim';

export type CompartilharResultado = 'email' | 'compartilhado' | 'eml';

function isWeb(): boolean {
  return Platform.OS === 'web' || (typeof document !== 'undefined' && typeof window !== 'undefined');
}

/** Outlook trata "+" do URLSearchParams como literal; usamos %20. */
export function buildMailtoUrl(opts: {
  to?: string | null;
  subject: string;
  body: string;
}): string {
  const to = safeTrim(opts.to);
  const subject = safeTrim(opts.subject);
  const body = safeTrim(opts.body);
  const parts: string[] = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  const qs = parts.join('&');
  return qs ? `mailto:${to}?${qs}` : `mailto:${to}`;
}

export async function abrirEmail(opts: {
  to?: string | null;
  subject: string;
  body: string;
}): Promise<CompartilharResultado> {
  const url = buildMailtoUrl(opts);
  if (isWeb()) {
    window.location.href = url;
    return 'email';
  }
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
 * 2) .eml com anexo (Outlook abre rascunho com PDF/HTML anexado)
 * 3) baixa o arquivo + mailto sem link quebrado
 */
export async function compartilharComEmail(opts: {
  to?: string | null;
  subject: string;
  body: string;
  arquivo?: { uri?: string; blob?: Blob; filename: string; mimeType: string };
  preferirShareSheet?: boolean;
}): Promise<CompartilharResultado> {
  const preferirShare = opts.preferirShareSheet !== false;
  const subject = safeTrim(opts.subject);
  const body = safeTrim(opts.body);

  if (
    isWeb() &&
    typeof navigator !== 'undefined' &&
    opts.arquivo?.blob &&
    typeof File !== 'undefined'
  ) {
    const file = new File([opts.arquivo.blob], opts.arquivo.filename, {
      type: opts.arquivo.mimeType,
    });
    const shareData: ShareData = { title: subject, text: body, files: [file] };
    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return 'compartilhado';
    }

    // Rascunho .eml com anexo — abre no Outlook com o arquivo anexado.
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
    // Também baixa o PDF/HTML solto, caso o usuário prefira anexar manualmente.
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
      /* fallback mailto */
    }
  }

  return abrirEmail({ to: opts.to, subject, body });
}
