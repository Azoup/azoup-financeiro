const { decrypt } = require('../../nfe/_lib/crypto');
const { cleanupCert, downloadCertToTemp } = require('./sicoobClient');

async function loadSicoobCredentials(admin, userId) {
  const { data: config, error: cErr } = await admin
    .from('config_sicoob')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!config?.ativo) return null;

  const { data: cert } = await admin
    .from('empresa_certificado')
    .select('*')
    .eq('user_id', userId)
    .eq('ativo', true)
    .maybeSingle();
  if (!cert) throw new Error('Certificado A1 não encontrado.');

  const { data: sec } = await admin
    .from('empresa_certificado_secreto')
    .select('senha_criptografada')
    .eq('certificado_id', cert.id)
    .maybeSingle();
  if (!sec?.senha_criptografada) {
    throw new Error('Senha do certificado A1 não encontrada.');
  }

  const certPath = await downloadCertToTemp(admin, cert.storage_path);
  const senha = decrypt(sec.senha_criptografada);
  return { config, certPath, senha };
}

module.exports = { loadSicoobCredentials };
