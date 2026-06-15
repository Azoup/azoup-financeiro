import { CLIENTES_PDFS_BUCKET } from '@/constants/storage';
import { supabase } from '@/lib/supabase';

function sanitizeFilePart(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80) || 'documento';
}

export async function uploadClientePdf(params: {
  userId: string;
  clienteId: string;
  localUri: string;
  originalFileName: string;
}): Promise<string> {
  const res = await fetch(params.localUri);
  const buf = await res.arrayBuffer();
  const safe = sanitizeFilePart(params.originalFileName.replace(/\.pdf$/i, ''));
  const path = `${params.userId}/${params.clienteId}/${Date.now()}-${safe}.pdf`;

  const { error } = await supabase.storage.from(CLIENTES_PDFS_BUCKET).upload(path, buf, {
    contentType: 'application/pdf',
    upsert: false,
  });

  if (error) throw new Error(error.message);
  return path;
}

export async function removeClientePdf(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(CLIENTES_PDFS_BUCKET).remove([storagePath]);
  if (error) console.warn('removeClientePdf:', error.message);
}

export async function getClientePdfSignedUrl(
  storagePath: string,
  expiresInSeconds = 600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CLIENTES_PDFS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error('URL do PDF indisponível.');
  return data.signedUrl;
}
