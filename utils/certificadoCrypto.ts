/**
 * Criptografia AES-256-GCM compatível com api/nfe/_lib/crypto.js (Node).
 * Formato: iv_base64:tag_base64:ciphertext_base64
 */

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]!);
  if (typeof btoa !== 'undefined') return btoa(binary);
  throw new Error('Ambiente sem suporte a criptografia (btoa). Use a versão web.');
}

async function sha256Key(chave: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(chave);
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Criptografia indisponível neste dispositivo. Acesse pelo navegador web.');
  }
  return crypto.subtle.digest('SHA-256', data);
}

export async function encryptCertificadoSenha(senha: string, chave: string): Promise<string> {
  const trimmed = chave.trim();
  if (trimmed.length < 16) {
    throw new Error('Chave de segurança inválida (mín. 16 caracteres).');
  }
  if (!senha.trim()) {
    throw new Error('Informe a senha do certificado A1.');
  }

  const keyBytes = await sha256Key(trimmed);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(senha.trim());
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, plain);

  const enc = new Uint8Array(encrypted);
  const tagLen = 16;
  const cipher = enc.slice(0, enc.length - tagLen);
  const tag = enc.slice(enc.length - tagLen);

  return `${bytesToBase64(iv)}:${bytesToBase64(tag)}:${bytesToBase64(cipher)}`;
}
