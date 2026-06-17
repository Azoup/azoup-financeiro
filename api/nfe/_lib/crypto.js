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

module.exports = { encrypt, decrypt };
