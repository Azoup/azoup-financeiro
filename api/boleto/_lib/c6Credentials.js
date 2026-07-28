const fs = require('fs');
const { C6_SANDBOX, bundledCertPaths } = require('./c6SandboxDefaults');

/**
 * Carrega config_c6 + mTLS.
 * Se não houver cadastro/cert no Storage, usa credenciais e certificados sandbox fixos.
 */
async function loadC6Credentials(admin, userId, emitenteId) {
  let config = null;
  if (userId) {
    let query = admin.from('config_c6').select('*').eq('user_id', userId);
    if (emitenteId) {
      query = query.eq('emitente_id', emitenteId).maybeSingle();
    } else {
      query = query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    config = data;
  }

  const ativo = config?.ativo !== false;
  if (config && !ativo) return null;

  const merged = {
    ...(config ?? {}),
    ativo: true,
    ambiente: config?.ambiente || C6_SANDBOX.ambiente,
    client_id: (config?.client_id || '').trim() || C6_SANDBOX.client_id,
    client_secret: (config?.client_secret || '').trim() || C6_SANDBOX.client_secret,
    billing_scheme: (config?.billing_scheme || '').trim() || C6_SANDBOX.billing_scheme,
    pix_chave: C6_SANDBOX.pix_chave,
    emitente_id: config?.emitente_id || emitenteId || null,
    user_id: config?.user_id || userId,
  };

  if (config?.cert_crt_storage_path && config?.cert_key_storage_path) {
    const { downloadC6FileToTemp } = require('./c6Client');
    const certPath = await downloadC6FileToTemp(admin, config.cert_crt_storage_path, 'crt');
    const keyPath = await downloadC6FileToTemp(admin, config.cert_key_storage_path, 'key');
    return { config: merged, certPath, keyPath, bundled: false };
  }

  const bundled = bundledCertPaths();
  if (!fs.existsSync(bundled.certPath) || !fs.existsSync(bundled.keyPath)) {
    throw new Error(
      'Certificados C6 sandbox ausentes em api/boleto/_lib/certs/. Envie .crt/.key em Configurações › Boleto C6.',
    );
  }
  return { config: merged, certPath: bundled.certPath, keyPath: bundled.keyPath, bundled: true };
}

async function loadC6CredentialsForBoleto(admin, boleto) {
  return loadC6Credentials(admin, boleto.user_id, boleto.emitente_id);
}

module.exports = { loadC6Credentials, loadC6CredentialsForBoleto };
