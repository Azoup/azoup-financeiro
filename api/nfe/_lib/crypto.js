const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getKey() {
  const raw = process.env.CERT_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error('Configure CERT_ENCRYPTION_KEY (mín. 16 caracteres) na Vercel para o certificado A1.');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Senhas gravadas via RPC Supabase (prefixo pgp1:) ou legado AES Node. */
async function decryptCertPassword(admin, payload) {
  const s = String(payload ?? '');
  if (!s) throw new Error('Senha do certificado ausente.');
  if (s.startsWith('pgp1:')) {
    const { data, error } = await admin.rpc('descriptografar_senha_certificado', { p_enc: s });
    if (error) throw new Error(error.message);
    return data;
  }
  return decrypt(s);
}

async function syncCertEncryptionKeyToDb(admin) {
  const raw = process.env.CERT_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) return;
  await admin
    .from('app_runtime_config')
    .upsert({ key: 'cert_encryption_key', value: raw }, { onConflict: 'key' });
}

module.exports = { encrypt, decrypt, decryptCertPassword, syncCertEncryptionKeyToDb };
