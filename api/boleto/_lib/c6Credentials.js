const { C6_ACTIVE, C6_SANDBOX, bundledCertPaths } = require('./c6SandboxDefaults');

/**
 * Carrega config_c6 + mTLS.
 * Preferência: credenciais salvas em Configurações › Boleto C6.
 * Fallback: defaults bundled (só se o usuário ainda não cadastrou Client ID).
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

  const temCredenciaisSalvas = Boolean(
    (config?.client_id || '').trim() && (config?.client_secret || '').trim(),
  );

  let ambiente = (config?.ambiente || '').trim() || C6_ACTIVE.ambiente;
  let client_id = (config?.client_id || '').trim();
  let client_secret = (config?.client_secret || '').trim();
  let billing_scheme = (config?.billing_scheme || '').trim();

  if (!temCredenciaisSalvas) {
    // Sem cadastro do usuário: usa defaults ativos (compatibilidade).
    ambiente = C6_ACTIVE.ambiente;
    client_id = C6_ACTIVE.client_id;
    client_secret = C6_ACTIVE.client_secret;
    billing_scheme = C6_ACTIVE.billing_scheme;
  } else if (!billing_scheme) {
    billing_scheme = ambiente === 'producao' ? '15' : '21';
  }

  // Se ainda estiver com client_id de sandbox antigo e ambiente produção, migra defaults só
  // quando o usuário não trocou o secret (legado). Não sobrescreve credenciais customizadas.
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

  // Sem upload: tenta certs no deploy; em produção exige upload se não houver bundled.
  try {
    const bundled = bundledCertPaths(merged.ambiente);
    return {
      config: merged,
      certPath: bundled.certPath,
      keyPath: bundled.keyPath,
      bundled: true,
    };
  } catch (e) {
    throw new Error(
      `${e.message} Ou envie o certificado AZFS (.crt + .key) em Configurações › Boleto C6.`,
    );
  }
}

async function loadC6CredentialsForBoleto(admin, boleto) {
  return loadC6Credentials(admin, boleto.user_id, boleto.emitente_id);
}

module.exports = { loadC6Credentials, loadC6CredentialsForBoleto };
