const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function deriveKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function decryptWithRawKey(payload, keyRaw) {
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Formato de senha criptografada inválido.');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(keyRaw), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

async function fetchDbCertKey(admin) {
  if (!admin) return null;
  const { data, error } = await admin
    .from('app_runtime_config')
    .select('value')
    .eq('key', 'cert_encryption_key')
    .maybeSingle();
  if (error) return null;
  const value = data?.value?.trim();
  return value && value.length >= 16 ? value : null;
}

async function resolveCertEncryptionKeys(admin) {
  const keys = [];
  const env = process.env.CERT_ENCRYPTION_KEY?.trim();
  if (env && env.length >= 16) keys.push(env);
  const db = await fetchDbCertKey(admin);
  if (db && !keys.includes(db)) keys.push(db);
  return keys;
}

function encrypt(text) {
  const env = process.env.CERT_ENCRYPTION_KEY?.trim();
  if (!env || env.length < 16) {
    throw new Error(
      'Configure CERT_ENCRYPTION_KEY (mín. 16 caracteres) na Vercel — mesma chave definida em Configurações › NFS-e.',
    );
  }
  const key = deriveKey(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  const env = process.env.CERT_ENCRYPTION_KEY?.trim();
  if (!env || env.length < 16) {
    throw new Error('Configure CERT_ENCRYPTION_KEY (mín. 16 caracteres) na Vercel.');
  }
  return decryptWithRawKey(payload, env);
}

/** Senhas gravadas via RPC Supabase (prefixo pgp1:) ou AES (app / Vercel). */
async function decryptCertPassword(admin, payload) {
  const s = String(payload ?? '');
  if (!s) throw new Error('Senha do certificado ausente.');
  if (s.startsWith('pgp1:')) {
    const { data, error } = await admin.rpc('descriptografar_senha_certificado', { p_enc: s });
    if (error) throw new Error(error.message);
    return data;
  }

  const keys = await resolveCertEncryptionKeys(admin);
  if (!keys.length) {
    throw new Error(
      'Chave de criptografia não configurada. Defina CERT_ENCRYPTION_KEY na Vercel (Settings → Environment Variables) com a mesma chave usada em Configurações › NFS-e.',
    );
  }

  let lastErr;
  for (const keyRaw of keys) {
    try {
      return decryptWithRawKey(s, keyRaw);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    lastErr?.message?.includes('auth')
      ? 'Não foi possível descriptografar a senha do certificado. CERT_ENCRYPTION_KEY na Vercel deve ser igual à chave do app. Reenvie o certificado A1.'
      : lastErr?.message ?? 'Falha ao descriptografar senha do certificado.',
  );
}

async function syncCertEncryptionKeyToDb(admin) {
  const raw = process.env.CERT_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 16) return;
  await admin
    .from('app_runtime_config')
    .upsert({ key: 'cert_encryption_key', value: raw }, { onConflict: 'key' });
}

module.exports = { encrypt, decrypt, decryptCertPassword, syncCertEncryptionKeyToDb };
