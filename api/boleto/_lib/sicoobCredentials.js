const { decryptCertPassword } = require('../../nfe/_lib/crypto');
const { cleanupCert, downloadCertToTemp } = require('./sicoobClient');

/**
 * Escolhe um certificado A1 ativo para Sicoob quando há vários (multi-emitente NFS-e).
 * Preferência: emitente padrão → cert sem emitente (legado) → mais recente.
 */
async function resolveCertificadoAtivo(admin, userId) {
  const { data: certs, error } = await admin
    .from('empresa_certificado')
    .select('*')
    .eq('user_id', userId)
    .eq('ativo', true)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = certs ?? [];
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];

  const emitenteIds = [...new Set(rows.map((c) => c.emitente_id).filter(Boolean))];
  let padraoId = null;
  if (emitenteIds.length) {
    const { data: padrao } = await admin
      .from('nfse_emitente')
      .select('id')
      .eq('user_id', userId)
      .eq('padrao', true)
      .maybeSingle();
    padraoId = padrao?.id ?? null;
  }

  if (padraoId) {
    const byPadrao = rows.find((c) => c.emitente_id === padraoId);
    if (byPadrao) return byPadrao;
  }

  const legado = rows.find((c) => !c.emitente_id);
  if (legado) return legado;

  return rows[0];
}

async function loadSicoobCredentials(admin, userId) {
  const { data: config, error: cErr } = await admin
    .from('config_sicoob')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!config?.ativo) return null;

  const cert = await resolveCertificadoAtivo(admin, userId);
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
  const senha = await decryptCertPassword(admin, sec.senha_criptografada);
  return { config, certPath, senha };
}

module.exports = { loadSicoobCredentials, resolveCertificadoAtivo };
