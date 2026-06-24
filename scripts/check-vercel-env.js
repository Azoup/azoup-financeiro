/**
 * Aviso no build da Vercel se o Supabase não estiver configurado.
 * Não bloqueia o deploy — o app mostra aviso na tela até as variáveis existirem.
 */
function resolveSupabaseEnv() {
  const url = (
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ''
  ).trim();

  const key = (
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  ).trim();

  return { url, key };
}

if (process.env.VERCEL !== '1') {
  process.exit(0);
}

const { url, key } = resolveSupabaseEnv();

if (url && key) {
  console.log('[vercel] Supabase configurado para o build.');
  process.exit(0);
}

console.error(
  [
    '',
    '[vercel] ERRO: Supabase não configurado neste build.',
    'O site sobe sem conectar ao banco até você adicionar:',
    '',
    '  EXPO_PUBLIC_SUPABASE_URL',
    '  EXPO_PUBLIC_SUPABASE_ANON_KEY',
    '',
    'Vercel → Project → Settings → Environment Variables',
    'Marque Production + Preview + Development',
    'Depois: Deployments → Redeploy (sem cache, se já tinha variáveis)',
    '',
  ].join('\n'),
);

process.exit(1);
