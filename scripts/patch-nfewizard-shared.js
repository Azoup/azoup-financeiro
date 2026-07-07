/**
 * Patches @nfewizard/shared para Vercel/serverless:
 * 1) CAs ICP em NFEWIZARD_CA_CERTS_DIR
 * 2) Homologação (dfe.ambiente === 2) sempre com rejectUnauthorized: false
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sharedCjs = path.join(root, 'node_modules', '@nfewizard', 'shared', 'dist', 'index.cjs');

if (!fs.existsSync(sharedCjs)) {
  console.warn('[patch-nfewizard-shared] @nfewizard/shared não instalado — pulando.');
  process.exit(0);
}

let src = fs.readFileSync(sharedCjs, 'utf8');
let changed = false;

if (!src.includes('NFEWIZARD_CA_CERTS_DIR')) {
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
    console.warn('[patch-nfewizard-shared] Padrão de CAs não encontrado — verifique a versão do pacote.');
  } else {
    src = src.replace(needle, replacement);
    changed = true;
    console.log('[patch-nfewizard-shared] CAs via NFEWIZARD_CA_CERTS_DIR.');
  }
}

const tlsNeedle = `else if (this.config.dfe.ambiente === 2) {
                        // Homologação: accept self-signed certificates
                        agentOptions.rejectUnauthorized = false;
                    }`;
const tlsReplacement = `if (this.config.dfe.ambiente === 2) {
                        agentOptions.rejectUnauthorized = false;
                    }`;

const tlsNeedle2 = `else if (this.config.dfe.ambiente === 2) {
                    // Homologação: accept self-signed certificates
                    agentOptions.rejectUnauthorized = false;
                }`;
const tlsReplacement2 = `if (this.config.dfe.ambiente === 2) {
                    agentOptions.rejectUnauthorized = false;
                }`;

if (src.includes(tlsNeedle)) {
  src = src.replace(tlsNeedle, tlsReplacement);
  changed = true;
  console.log('[patch-nfewizard-shared] TLS homologação (PEM) — rejectUnauthorized sempre false.');
}

if (src.includes(tlsNeedle2)) {
  src = src.replace(tlsNeedle2, tlsReplacement2);
  changed = true;
  console.log('[patch-nfewizard-shared] TLS homologação (OpenSSL) — rejectUnauthorized sempre false.');
}

if (changed) {
  fs.writeFileSync(sharedCjs, src);
} else if (src.includes('if (this.config.dfe.ambiente === 2) {\n                        agentOptions.rejectUnauthorized = false;')) {
  console.log('[patch-nfewizard-shared] já aplicado.');
} else {
  console.warn('[patch-nfewizard-shared] Nenhum patch TLS aplicado — padrão não encontrado.');
}
