import { supabase } from '@/lib/supabase';
import type { C6Config, C6ConfigInput } from '@/types/c6';
import {
  C6_ACTIVE_DEFAULTS,
  isC6CobradorCnpj,
  onlyDigitsCnpj,
} from '@/services/c6SandboxDefaults';
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
    ativo: false,
    ambiente: C6_ACTIVE_DEFAULTS.ambiente,
    client_id: '',
    client_secret: '',
    billing_scheme: C6_ACTIVE_DEFAULTS.billing_scheme,
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
    existing?.billing_scheme ||
    (ambiente === 'producao' ? '15' : '21');

  const secretNovo = input.client_secret.trim();
  const clientId = input.client_id.trim() || existing?.client_id?.trim() || '';

  const row: Record<string, unknown> = {
    user_id: userId,
    emitente_id: input.emitente_id,
    ativo: input.ativo,
    ambiente: ambiente || existing?.ambiente || 'producao',
    client_id: clientId,
    client_secret: secretNovo || existing?.client_secret || '',
    billing_scheme: billing,
    webhook_token:
      input.webhook_token === undefined
        ? existing?.webhook_token ?? null
        : input.webhook_token?.trim() || null,
  };

  if (input.cert_crt_storage_path !== undefined) {
    row.cert_crt_storage_path = input.cert_crt_storage_path;
  } else if (existing?.cert_crt_storage_path) {
    row.cert_crt_storage_path = existing.cert_crt_storage_path;
  }
  if (input.cert_key_storage_path !== undefined) {
    row.cert_key_storage_path = input.cert_key_storage_path;
  } else if (existing?.cert_key_storage_path) {
    row.cert_key_storage_path = existing.cert_key_storage_path;
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

/** Grava só os caminhos do mTLS — não apaga Client ID/Secret. */
export async function salvarCertPathsC6(
  userId: string,
  emitenteId: string,
  paths: { cert_crt_storage_path: string; cert_key_storage_path: string },
): Promise<C6Config> {
  const existing = await ensureC6Config(userId, emitenteId);
  await upsertC6Config(userId, {
    emitente_id: emitenteId,
    ativo: existing.ativo !== false,
    ambiente: existing.ambiente === 'sandbox' ? 'sandbox' : 'producao',
    client_id: existing.client_id || '',
    client_secret: '',
    billing_scheme: existing.billing_scheme || '15',
    webhook_token: existing.webhook_token,
    cert_crt_storage_path: paths.cert_crt_storage_path,
    cert_key_storage_path: paths.cert_key_storage_path,
  });
  const refreshed = await fetchC6Config(userId, emitenteId);
  if (!refreshed?.cert_crt_storage_path || !refreshed?.cert_key_storage_path) {
    throw new Error(
      'O certificado foi enviado, mas os caminhos não gravaram em config_c6. Tente de novo ou rode a migration 045_c6_boleto.sql.',
    );
  }
  return refreshed;
}

/** Garante linha em config_c6 sem sobrescrever credenciais já salvas pelo usuário. */
export async function ensureC6Config(userId: string, emitenteId: string): Promise<C6Config> {
  const existing = await fetchC6Config(userId, emitenteId);
  if (existing) return existing;
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

/**
 * Web: um único diálogo (gesture) pedindo os 2 arquivos — o 2º click após await
 * costuma ser bloqueado pelo navegador e o certificado “não grava”.
 */
export async function pickC6CertPair(): Promise<{ crt: C6CertFilePick; key: C6CertFilePick } | null> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return null;
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.crt,.cer,.pem,.key,text/plain,application/x-x509-ca-cert,*/*';
      input.onchange = () => {
        const files = [...(input.files ?? [])];
        if (files.length < 2) {
          resolve(null);
          return;
        }
        const byExt = (re: RegExp) => files.find((f) => re.test(f.name));
        const crtFile =
          byExt(/\.crt$/i) || byExt(/\.cer$/i) || byExt(/\.pem$/i) || files[0]!;
        const keyFile =
          byExt(/\.key$/i) ||
          files.find((f) => f !== crtFile && /\.pem$/i.test(f.name)) ||
          files.find((f) => f !== crtFile) ||
          files[1]!;
        if (!crtFile || !keyFile || crtFile === keyFile) {
          resolve(null);
          return;
        }
        resolve({
          crt: {
            uri: URL.createObjectURL(crtFile),
            name: crtFile.name,
            mimeType: crtFile.type,
            blob: crtFile,
          },
          key: {
            uri: URL.createObjectURL(keyFile),
            name: keyFile.name,
            mimeType: keyFile.type,
            blob: keyFile,
          },
        });
      };
      input.click();
    });
  }

  const crt = await pickC6CertFile('crt');
  if (!crt) return null;
  const key = await pickC6CertFile('key');
  if (!key) return null;
  return { crt, key };
}

async function uploadOneC6File(
  path: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from('c6_certs')
    .upload(path, blob, { contentType, upsert: true });
  if (!error) return;

  // Fallback: remove + insert (alguns projetos bloqueiam upsert sem WITH CHECK).
  await supabase.storage.from('c6_certs').remove([path]);
  const { error: e2 } = await supabase.storage
    .from('c6_certs')
    .upload(path, blob, { contentType, upsert: false });
  if (e2) {
    throw new Error(
      `Falha ao enviar certificado (${path}): ${e2.message}. Confirme o bucket c6_certs e a migration 045/050.`,
    );
  }
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

  if (!crtBlob.size || !keyBlob.size) {
    throw new Error('Arquivo de certificado ou chave vazio. Selecione novamente o .crt e o .key.');
  }

  await uploadOneC6File(crtPath, crtBlob, 'application/x-x509-ca-cert');
  await uploadOneC6File(keyPath, keyBlob, 'application/octet-stream');

  // Confirma que o Storage realmente ficou com os arquivos.
  const { data: listed, error: listErr } = await supabase.storage
    .from('c6_certs')
    .list(`${userId}/${emitenteId}`);
  if (listErr) {
    throw new Error(`Certificado enviado, mas não foi possível confirmar: ${listErr.message}`);
  }
  const names = new Set((listed ?? []).map((f) => f.name));
  if (!names.has('cert.crt') || !names.has('cert.key')) {
    throw new Error(
      'Os arquivos não ficaram no Storage. Verifique permissões do bucket c6_certs (migration 045/050).',
    );
  }

  return { cert_crt_storage_path: crtPath, cert_key_storage_path: keyPath };
}

/**
 * Preferência C6: CNPJ cobrador conhecido, depois banco_cobranca=c6.
 */
export function pickEmitenteC6<
  T extends { id: string; padrao: boolean; banco_cobranca?: string; documento?: string },
>(list: T[]): T | null {
  if (!list.length) return null;
  return (
    list.find((e) => isC6CobradorCnpj(e.documento)) ??
    list.find((e) => e.banco_cobranca === 'c6') ??
    list.find((e) => onlyDigitsCnpj(e.documento).length === 14 && e.banco_cobranca === 'c6') ??
    list.find((e) => !e.padrao) ??
    (list.length > 1 ? list[1] : null) ??
    null
  );
}
