/**
 * Falha o build na Vercel se o Supabase não estiver configurado.
 * Evita deploy "ok" que abre tela em branco / sem login.
 */
if (process.env.VERCEL !== '1') {
  process.exit(0);
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (url && key) {
  console.log('[vercel] Variáveis do Supabase encontradas.');
  process.exit(0);
}

console.error(
  [
    '',
    'Deploy na Vercel: configure as variáveis de ambiente do Supabase.',
    '',
    '  EXPO_PUBLIC_SUPABASE_URL',
    '  EXPO_PUBLIC_SUPABASE_ANON_KEY',
    '',
    'Painel Vercel → Project → Settings → Environment Variables',
    'Marque Production, Preview e Development. Depois faça Redeploy.',
    '',
  ].join('\n'),
);

process.exit(1);
