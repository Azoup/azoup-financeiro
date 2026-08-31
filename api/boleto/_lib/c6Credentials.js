const { C6_ACTIVE, C6_SANDBOX, bundledCertPaths } = require('./c6SandboxDefaults');

/**
 * Carrega config_c6 + mTLS.
 * Preferência: banco → defaults ativos (produção).
 * Migra automaticamente config antiga de sandbox para produção.
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
    if (error && !/relation|does not exist|42P01/i.test(error.message)) {
      throw new Error(error.message);
    }
    config = data;
  }

  if (config && config.ativo === false) {
    throw new Error('Integração C6 está inativa em Configurações › Boleto C6. Ative para emitir boleto real.');
  }

  let ambiente = (config?.ambiente || C6_ACTIVE.ambiente).trim();
  let client_id = (config?.client_id || '').trim() || C6_ACTIVE.client_id;
  let client_secret = (config?.client_secret || '').trim() || C6_ACTIVE.client_secret;
  let billing_scheme = (config?.billing_scheme || '').trim() || C6_ACTIVE.billing_scheme;

  // Migra sandbox legado → produção (defaults ativos)
  if (
    C6_ACTIVE.ambiente === 'producao' &&
    (ambiente === 'sandbox' || client_id === C6_SANDBOX.client_id)
  ) {
    ambiente = C6_ACTIVE.ambiente;
    client_id = C6_ACTIVE.client_id;
    client_secret = C6_ACTIVE.client_secret;
    billing_scheme = C6_ACTIVE.billing_scheme;
  }

  const merged = {
    ...(config ?? {}),
    ativo: true,
    ambiente,
    client_id,
    client_secret,
    billing_scheme,
    pix_chave: (config?.pix_chave || '').trim() || C6_ACTIVE.pix_chave || '',
    emitente_id: config?.emitente_id || emitenteId || null,
    user_id: config?.user_id || userId,
  };

  if (!merged.client_id || !merged.client_secret) {
    throw new Error('Credenciais C6 ausentes (Client ID / Secret).');
  }

  if (config?.cert_crt_storage_path && config?.cert_key_storage_path) {
    const { downloadC6FileToTemp } = require('./c6Client');
    const certPath = await downloadC6FileToTemp(admin, config.cert_crt_storage_path, 'crt');
    const keyPath = await downloadC6FileToTemp(admin, config.cert_key_storage_path, 'key');
    return { config: merged, certPath, keyPath, bundled: false };
  }

  const bundled = bundledCertPaths(merged.ambiente);
  return {
    config: merged,
    certPath: bundled.certPath,
    keyPath: bundled.keyPath,
    bundled: true,
  };
}

async function loadC6CredentialsForBoleto(admin, boleto) {
  return loadC6Credentials(admin, boleto.user_id, boleto.emitente_id);
}

module.exports = { loadC6Credentials, loadC6CredentialsForBoleto };
