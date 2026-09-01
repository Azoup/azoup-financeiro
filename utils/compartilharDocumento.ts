import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

export type CompartilharResultado = 'email' | 'compartilhado';

export function buildMailtoUrl(opts: {
  to?: string | null;
  subject: string;
  body: string;
}): string {
  const to = opts.to?.trim() || '';
  const params = new URLSearchParams();
  if (opts.subject) params.set('subject', opts.subject);
  if (opts.body) params.set('body', opts.body);
  const qs = params.toString();
  return qs ? `mailto:${to}?${qs}` : `mailto:${to}`;
}

export async function abrirEmail(opts: {
  to?: string | null;
  subject: string;
  body: string;
}): Promise<CompartilharResultado> {
  const url = buildMailtoUrl(opts);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
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
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    opts.arquivo?.blob &&
    typeof File !== 'undefined'
  ) {
    const file = new File([opts.arquivo.blob], opts.arquivo.filename, { type: opts.arquivo.mimeType });
    const shareData: ShareData = { title: opts.subject, text: opts.body, files: [file] };
    if (navigator.share && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return 'compartilhado';
    }
  }

  if (preferirShare && opts.arquivo?.uri && Platform.OS !== 'web') {
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
