const { createClient } = require('@supabase/supabase-js');

function getAdmin() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Configure SUPABASE_SERVICE_ROLE_KEY e EXPO_PUBLIC_SUPABASE_URL na Vercel.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getUserFromBearer(req) {
  const auth = req.headers.authorization ?? req.headers.Authorization;
  if (!auth?.startsWith('Bearer ')) {
    throw new Error('Não autorizado.');
  }
  const token = auth.slice(7);
  const admin = getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('Token inválido ou expirado.');
  return data.user;
}

module.exports = { getAdmin, getUserFromBearer };
