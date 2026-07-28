import { supabase } from '@/lib/supabase';
import type { C6Config, C6ConfigInput } from '@/types/c6';
import { C6_SANDBOX_DEFAULTS } from '@/services/c6SandboxDefaults';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

export type C6CertFilePick = {
  uri: string;
  name: string;
  mimeType?: string | null;
  blob?: Blob;
};

export function c6ConfigDefaults(emitenteId: string): C6ConfigInput {
  return {
    emitente_id: emitenteId,
    ativo: C6_SANDBOX_DEFAULTS.ativo,
    ambiente: C6_SANDBOX_DEFAULTS.ambiente,
    client_id: C6_SANDBOX_DEFAULTS.client_id,
    client_secret: C6_SANDBOX_DEFAULTS.client_secret,
    billing_scheme: C6_SANDBOX_DEFAULTS.billing_scheme,
    webhook_token: null,
  };
}

export async function fetchC6Config(userId: string, emitenteId: string): Promise<C6Config | null> {
  const { data, error } = await supabase
    .from('config_c6')
    .select('*')
    .eq('user_id', userId)
    .eq('emitente_id', emitenteId)
    .maybeSingle();
  if (error) {
    if (/config_c6|relation|does not exist|42P01/i.test(error.message)) {
      throw new Error('Rode a migration 045_c6_boleto.sql no SQL Editor do Supabase.');
    }
    throw new Error(error.message);
  }
  return (data as C6Config | null) ?? null;
}

export async function fetchC6ConfigsByUser(userId: string): Promise<C6Config[]> {
  const { data, error } = await supabase.from('config_c6').select('*').eq('user_id', userId);
  if (error) {
    if (/config_c6|relation|does not exist|42P01/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data as C6Config[]) ?? [];
}

export async function upsertC6Config(userId: string, input: C6ConfigInput): Promise<void> {
  const existing = await fetchC6Config(userId, input.emitente_id).catch(() => null);
  const ambiente = input.ambiente;
  const billing =
    input.billing_scheme?.trim() ||
    (ambiente === 'producao' ? '15' : '21');

  const row: Record<string, unknown> = {
    user_id: userId,
    emitente_id: input.emitente_id,
    ativo: input.ativo,
    ambiente,
    client_id: input.client_id.trim() || C6_SANDBOX_DEFAULTS.client_id,
    client_secret:
      input.client_secret.trim() || existing?.client_secret || C6_SANDBOX_DEFAULTS.client_secret,
    billing_scheme: billing,
    webhook_token: input.webhook_token?.trim() || null,
  };

  if (input.cert_crt_storage_path !== undefined) {
    row.cert_crt_storage_path = input.cert_crt_storage_path;
  }
  if (input.cert_key_storage_path !== undefined) {
    row.cert_key_storage_path = input.cert_key_storage_path;
  }

  const { error } = await supabase.from('config_c6').upsert(row, {
    onConflict: 'emitente_id',
  });
  if (error) {
    if (/config_c6|relation|does not exist|42P01|banco_cobranca/i.test(error.message)) {
      throw new Error('Rode a migration 045_c6_boleto.sql no SQL Editor do Supabase.');
    }
    throw new Error(error.message);
  }
}

export async function ensureC6Config(userId: string, emitenteId: string): Promise<C6Config> {
  const existing = await fetchC6Config(userId, emitenteId);
  if (existing) {
    if (!existing.client_id?.trim() || !existing.client_secret?.trim()) {
      await upsertC6Config(userId, {
        emitente_id: emitenteId,
        ativo: existing.ativo || C6_SANDBOX_DEFAULTS.ativo,
        ambiente: existing.ambiente || C6_SANDBOX_DEFAULTS.ambiente,
        client_id: existing.client_id || C6_SANDBOX_DEFAULTS.client_id,
        client_secret: existing.client_secret || C6_SANDBOX_DEFAULTS.client_secret,
        billing_scheme: existing.billing_scheme || C6_SANDBOX_DEFAULTS.billing_scheme,
        webhook_token: existing.webhook_token,
      });
      const refreshed = await fetchC6Config(userId, emitenteId);
      if (refreshed) return refreshed;
    }
    return existing;
  }
  await upsertC6Config(userId, c6ConfigDefaults(emitenteId));
  const created = await fetchC6Config(userId, emitenteId);
  if (!created) throw new Error('Não foi possível criar configuração C6.');
  return created;
}

async function fileToBlob(file: C6CertFilePick): Promise<Blob> {
  if (file.blob) return file.blob;
  const res = await fetch(file.uri);
  return res.blob();
}

export async function pickC6CertFile(kind: 'crt' | 'key'): Promise<C6CertFilePick | null> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return null;
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = kind === 'crt' ? '.crt,.pem,.cer,text/plain' : '.key,.pem,text/plain';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) {
          resolve(null);
          return;
        }
        resolve({ uri: URL.createObjectURL(f), name: f.name, mimeType: f.type, blob: f });
      };
      input.click();
    });
  }

  const res = await DocumentPicker.getDocumentAsync({
    type: ['*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, mimeType: a.mimeType };
}

export async function uploadC6CertPair(
  userId: string,
  emitenteId: string,
  crt: C6CertFilePick,
  key: C6CertFilePick,
): Promise<{ cert_crt_storage_path: string; cert_key_storage_path: string }> {
  const crtPath = `${userId}/${emitenteId}/cert.crt`;
  const keyPath = `${userId}/${emitenteId}/cert.key`;
  const crtBlob = await fileToBlob(crt);
  const keyBlob = await fileToBlob(key);

  const { error: e1 } = await supabase.storage
    .from('c6_certs')
    .upload(crtPath, crtBlob, { contentType: 'application/x-x509-ca-cert', upsert: true });
  if (e1) throw new Error(e1.message);

  const { error: e2 } = await supabase.storage
    .from('c6_certs')
    .upload(keyPath, keyBlob, { contentType: 'application/octet-stream', upsert: true });
  if (e2) throw new Error(e2.message);

  return { cert_crt_storage_path: crtPath, cert_key_storage_path: keyPath };
}

/** Preferência: emitente 2 (não padrão) = C6. */
export function pickEmitenteC6<T extends { id: string; padrao: boolean; banco_cobranca?: string }>(
  list: T[],
): T | null {
  if (!list.length) return null;
  return (
    list.find((e) => e.banco_cobranca === 'c6') ??
    list.find((e) => !e.padrao) ??
    (list.length > 1 ? list[1] : null) ??
    null
  );
}
