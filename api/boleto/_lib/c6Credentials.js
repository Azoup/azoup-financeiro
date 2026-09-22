const {
  C6_ACTIVE,
  C6_SANDBOX,
  bundledCertPaths,
  onlyDigits,
} = require('./c6SandboxDefaults');

async function resolveEmitenteCnpj(admin, emitenteId) {
  if (!emitenteId) return null;
  const { data, error } = await admin
    .from('nfse_emitente')
    .select('documento')
    .eq('id', emitenteId)
    .maybeSingle();
  if (error || !data) return null;
  return onlyDigits(data.documento);
}

/**
 * Carrega config_c6 + mTLS.
 * Preferência: upload em Configurações › Boleto C6 (por CNPJ).
 * Fallback: certs bundled (AZFS → azfs-*.txt; outro → prod-*.txt).
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
    throw new Error(
      'Integração C6 está inativa em Configurações › Boleto C6. Ative para emitir boleto real.',
    );
  }

  const emitenteCnpj = await resolveEmitenteCnpj(admin, emitenteId || config?.emitente_id);

  const temCredenciaisSalvas = Boolean(
    (config?.client_id || '').trim() && (config?.client_secret || '').trim(),
  );

  let ambiente = (config?.ambiente || '').trim() || C6_ACTIVE.ambiente;
  let client_id = (config?.client_id || '').trim();
  let client_secret = (config?.client_secret || '').trim();
  let billing_scheme = (config?.billing_scheme || '').trim();

  if (!temCredenciaisSalvas) {
    ambiente = C6_ACTIVE.ambiente;
    client_id = C6_ACTIVE.client_id;
    client_secret = C6_ACTIVE.client_secret;
    billing_scheme = C6_ACTIVE.billing_scheme;
  } else if (!billing_scheme) {
    billing_scheme = ambiente === 'producao' ? '15' : '21';
  }

  if (
    temCredenciaisSalvas &&
    C6_ACTIVE.ambiente === 'producao' &&
    client_id === C6_SANDBOX.client_id
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
    cobrador_cnpj: emitenteCnpj || null,
  };

  if (!merged.client_id || !merged.client_secret) {
    throw new Error(
      'Credenciais C6 ausentes. Informe Client ID e Client Secret em Configurações › Boleto C6.',
    );
  }

  if (config?.cert_crt_storage_path && config?.cert_key_storage_path) {
    const { downloadC6FileToTemp } = require('./c6Client');
    const certPath = await downloadC6FileToTemp(admin, config.cert_crt_storage_path, 'crt');
    const keyPath = await downloadC6FileToTemp(admin, config.cert_key_storage_path, 'key');
    return { config: merged, certPath, keyPath, bundled: false };
  }

  try {
    const bundled = bundledCertPaths(merged.ambiente, { cnpj: emitenteCnpj });
    return {
      config: merged,
      certPath: bundled.certPath,
      keyPath: bundled.keyPath,
      bundled: true,
      certProfile: bundled.profile || null,
    };
  } catch (e) {
    throw new Error(
      `${e.message} Ou envie o certificado (.crt + .key) em Configurações › Boleto C6.`,
    );
  }
}

async function loadC6CredentialsForBoleto(admin, boleto) {
  return loadC6Credentials(admin, boleto.user_id, boleto.emitente_id);
}

module.exports = { loadC6Credentials, loadC6CredentialsForBoleto };
