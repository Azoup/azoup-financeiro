const { createClient } = require('@supabase/supabase-js');

function getAzoupAdminClient() {
  const url = (
    process.env.AZOUP_ADMIN_SUPABASE_URL ??
    process.env.SUPABASE_AZOUP_ADMIN_URL ??
    ''
  ).trim();
  const key = (
    process.env.AZOUP_ADMIN_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_AZOUP_ADMIN_SERVICE_ROLE_KEY ??
    ''
  ).trim();

  if (!url || !key) {
    throw new Error(
      'Banco Azoup Admin não configurado. Na Vercel, cadastre AZOUP_ADMIN_SUPABASE_URL e AZOUP_ADMIN_SUPABASE_SERVICE_ROLE_KEY (somente leitura no código).',
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = { getAzoupAdminClient };
