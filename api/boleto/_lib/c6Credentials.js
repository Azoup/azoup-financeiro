/**
 * Carrega config_c6 + arquivos mTLS (.crt / .key) do Storage.
 */
async function loadC6Credentials(admin, userId, emitenteId) {
  let query = admin.from('config_c6').select('*').eq('user_id', userId).eq('ativo', true);
  if (emitenteId) {
    query = query.eq('emitente_id', emitenteId).maybeSingle();
  } else {
    query = query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  }
  const { data: config, error } = await query;
  if (error) throw new Error(error.message);
  if (!config) return null;

  if (!config.client_id?.trim() || !config.client_secret?.trim()) {
    throw new Error('Configure Client ID e Client Secret em Configurações › Boleto C6.');
  }
  if (!config.cert_crt_storage_path || !config.cert_key_storage_path) {
    throw new Error('Envie os certificados .crt e .key em Configurações › Boleto C6.');
  }

  const { downloadC6FileToTemp } = require('./c6Client');
  const certPath = await downloadC6FileToTemp(admin, config.cert_crt_storage_path, 'crt');
  const keyPath = await downloadC6FileToTemp(admin, config.cert_key_storage_path, 'key');
  return { config, certPath, keyPath };
}

async function loadC6CredentialsForBoleto(admin, boleto) {
  return loadC6Credentials(admin, boleto.user_id, boleto.emitente_id);
}

module.exports = { loadC6Credentials, loadC6CredentialsForBoleto };
