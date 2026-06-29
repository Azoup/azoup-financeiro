/**
 * Gera bundle PEM com CAs ICP-Brasil do @nfewizard/shared para TLS com SEFAZ/NFS-e na Vercel.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outFile = path.join(root, 'api', 'nfe', '_lib', 'icp-brasil-ca-bundle.pem');

function findCertDirs(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(dir, ent.name);
    if (ent.name === 'certs' && full.includes('resources')) {
      found.push(full);
      continue;
    }
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    if (full.split(path.sep).length - root.split(path.sep).length > 8) continue;
    findCertDirs(full, found);
  }
  return found;
}

function readCertFiles(dir) {
  const chunks = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(crt|cer|pem)$/i.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const buf = fs.readFileSync(file);
      if (!buf.length) continue;
      const text = buf.toString('utf8').trim();
      if (text.includes('BEGIN CERTIFICATE')) {
        chunks.push(text);
      }
    } catch {
      /* ignore single file */
    }
  }
  return chunks;
}

function main() {
  const nm = path.join(root, 'node_modules');
  const dirs = [...new Set(findCertDirs(nm))];
  const parts = [];

  for (const dir of dirs) {
    parts.push(...readCertFiles(dir));
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  if (!parts.length) {
    console.warn(
      '[bundle-icp-certs] Nenhum CA ICP-Brasil encontrado em node_modules. Rode npm install antes do deploy.',
    );
    if (!fs.existsSync(outFile)) {
      fs.writeFileSync(outFile, '# bundle vazio — execute npm install\n');
    }
    return;
  }

  const body = parts
    .map((p) => (typeof p === 'string' ? p.trim() : p))
    .filter(Boolean)
    .join('\n\n');
  fs.writeFileSync(outFile, `${body}\n`);
  console.log(`[bundle-icp-certs] ${parts.length} certificado(s) → ${path.relative(root, outFile)}`);
}

main();
