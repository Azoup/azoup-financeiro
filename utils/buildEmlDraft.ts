import { safeTrim } from '@/utils/safeTrim';

export type EmlAttachment = {
  filename: string;
  mimeType: string;
  /** Conteúdo em base64 (sem prefixo data:). */
  contentBase64: string;
};

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function foldBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
}

/**
 * Gera um .eml com X-Unsent:1 para o Outlook abrir como rascunho
 * já com destinatário, assunto, corpo e anexos.
 */
export function buildEmlDraft(opts: {
  to?: string | null;
  subject: string;
  body: string;
  attachments?: EmlAttachment[];
}): string {
  const to = safeTrim(opts.to);
  const subject = safeTrim(opts.subject).replace(/\+/g, ' ');
  // Texto puro com CRLF — sem URL-encoding (evita "+" no Outlook)
  const body = safeTrim(opts.body)
    .replace(/\+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\r\n');
  const attachments = opts.attachments ?? [];
  const boundary = `Azoup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const headers = [
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    to ? `To: ${to}` : null,
    `Subject: =?UTF-8?B?${encodeUtf8Base64(subject)}?=`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter((l): l is string => l != null);

  const parts: string[] = [];
  parts.push(
    `--${boundary}\r\n` +
      'Content-Type: text/plain; charset="UTF-8"\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      `${foldBase64(encodeUtf8Base64(body))}\r\n`,
  );

  for (const att of attachments) {
    const name = safeTrim(att.filename) || 'anexo.bin';
    const mime = safeTrim(att.mimeType) || 'application/octet-stream';
    const b64 = safeTrim(att.contentBase64).replace(/\s+/g, '');
    if (!b64) continue;
    parts.push(
      `--${boundary}\r\n` +
        `Content-Type: ${mime}; name="${name}"\r\n` +
        'Content-Transfer-Encoding: base64\r\n' +
        `Content-Disposition: attachment; filename="${name}"\r\n\r\n` +
        `${foldBase64(b64)}\r\n`,
    );
  }

  parts.push(`--${boundary}--\r\n`);
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('')}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Baixa um .eml no navegador (Outlook abre como rascunho com anexo). */
export function downloadEmlFile(filename: string, emlContent: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([emlContent], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.eml') ? filename : `${filename}.eml`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
