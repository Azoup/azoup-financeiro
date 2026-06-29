/**
 * Permite que @nfewizard/shared leia CAs ICP de api/nfe/_lib/nfewizard-certs na Vercel.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sharedCjs = path.join(root, 'node_modules', '@nfewizard', 'shared', 'dist', 'index.cjs');

if (!fs.existsSync(sharedCjs)) {
  console.warn('[patch-nfewizard-shared] @nfewizard/shared não instalado — pulando.');
  process.exit(0);
}

const src = fs.readFileSync(sharedCjs, 'utf8');
if (src.includes('NFEWIZARD_CA_CERTS_DIR')) {
  console.log('[patch-nfewizard-shared] já aplicado.');
  process.exit(0);
}

const needle = "const dir = path.join(baseDir, '../resources/certs');";
const replacement = `const dir = (() => {
  const envDir = process.env.NFEWIZARD_CA_CERTS_DIR;
  if (envDir) {
    try {
      if (fs.existsSync(envDir) && fs.readdirSync(envDir).filter((f) => !f.startsWith('.')).length > 0) {
        return envDir;
      }
    } catch {
      /* ignore */
    }
  }
  return path.join(baseDir, '../resources/certs');
})();`;

if (!src.includes(needle)) {
  console.warn('[patch-nfewizard-shared] Padrão não encontrado em index.cjs — verifique a versão do pacote.');
  process.exit(0);
}

fs.writeFileSync(sharedCjs, src.replace(needle, replacement));
console.log('[patch-nfewizard-shared] LoadCertificate usará NFEWIZARD_CA_CERTS_DIR quando definido.');
