const { getAdmin } = require('./_lib/supabaseAdmin');
const fs = require('fs');
const path = require('path');
const { prepareServerlessCryptoEnv } = require('./_lib/serverlessEnv');

prepareServerlessCryptoEnv();

/** GET /api/nfe/health — diagnóstico rápido (sem expor segredos). */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Use GET.' });
  }

  const bundlePath = path.join(__dirname, '_lib', 'icp-brasil-ca-bundle.pem');
  let icpBundleBytes = 0;
  try {
    icpBundleBytes = fs.statSync(bundlePath).size;
  } catch {
    /* */
  }

  const checks = {
    supabaseUrl: Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL),
    serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    certEncryptionKey: Boolean(process.env.CERT_ENCRYPTION_KEY?.trim()?.length >= 16),
    nodeUseSystemCa: process.env.NODE_USE_SYSTEM_CA === '1',
    icpBundleBytes,
    nfsePackage: false,
  };

  try {
    const mod = await import('@nfewizard/nfse');
    checks.nfsePackage = Boolean(mod?.default ?? mod?.NFSe);
  } catch (e) {
    checks.nfsePackageError = (e && e.message) || String(e);
  }

  let dbCertKey = false;
  try {
    const admin = getAdmin();
    const { data } = await admin
      .from('app_runtime_config')
      .select('value')
      .eq('key', 'cert_encryption_key')
      .maybeSingle();
    dbCertKey = Boolean(data?.value?.trim()?.length >= 16);
  } catch {
    /* ignore */
  }

  const ok =
    checks.supabaseUrl &&
    checks.serviceRoleKey &&
    (checks.certEncryptionKey || dbCertKey) &&
    checks.nfsePackage &&
    checks.icpBundleBytes > 100;

  return res.status(ok ? 200 : 503).json({
    ok,
    checks: { ...checks, dbCertKey },
  });
};
