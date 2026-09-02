import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';
import { safeTrim } from '@/utils/safeTrim';

export type CompartilharResultado = 'email' | 'compartilhado';

function isWeb(): boolean {
  return Platform.OS === 'web' || (typeof document !== 'undefined' && typeof window !== 'undefined');
}

export function buildMailtoUrl(opts: {
  to?: string | null;
  subject: string;
  body: string;
}): string {
  const to = safeTrim(opts.to);
  const params = new URLSearchParams();
  const subject = safeTrim(opts.subject);
  const body = safeTrim(opts.body);
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const qs = params.toString();
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

export async function compartilharComEmail(opts: {
  to?: string | null;
  subject: string;
  body: string;
  arquivo?: { uri?: string; blob?: Blob; filename: string; mimeType: string };
  /** No native, tenta share sheet antes do mailto (permite anexar em apps de e-mail). */
  preferirShareSheet?: boolean;
}): Promise<CompartilharResultado> {
  const preferirShare = opts.preferirShareSheet !== false;

  if (
    isWeb() &&
    typeof navigator !== 'undefined' &&
    opts.arquivo?.blob &&
    typeof File !== 'undefined'
  ) {
    const file = new File([opts.arquivo.blob], opts.arquivo.filename, { type: opts.arquivo.mimeType });
    const shareData: ShareData = {
      title: safeTrim(opts.subject),
      text: safeTrim(opts.body),
      files: [file],
    };
    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return 'compartilhado';
    }
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

  return abrirEmail({ to: opts.to, subject: opts.subject, body: opts.body });
}
