const { getAdmin } = require('./_lib/supabaseAdmin');

/** GET /api/nfe/health — diagnóstico rápido (sem expor segredos). */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Use GET.' });
  }

  const checks = {
    supabaseUrl: Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL),
    serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    certEncryptionKey: Boolean(process.env.CERT_ENCRYPTION_KEY?.trim()?.length >= 16),
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
    checks.nfsePackage;

  return res.status(ok ? 200 : 503).json({
    ok,
    checks: { ...checks, dbCertKey },
  });
};
