/**
 * Instalação Vercel/local sem Java: pula scripts do xsd-schema-validator,
 * aplica stub e recompila libxmljs2 (nfewizard usa validação XSD em JS).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const stubDir = path.join(root, 'patches', 'xsd-schema-validator-stub');

function findXsdValidatorDirs() {
  const found = [];
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) return found;

  function walkPackageDir(pkgDir) {
    const xsdDir = path.join(pkgDir, 'node_modules', 'xsd-schema-validator');
    if (fs.existsSync(path.join(xsdDir, 'package.json'))) {
      found.push(xsdDir);
    }
    const nestedNm = path.join(pkgDir, 'node_modules');
    if (!fs.existsSync(nestedNm)) return;
    for (const name of fs.readdirSync(nestedNm)) {
      if (name === 'xsd-schema-validator' || name.startsWith('.')) continue;
      const child = path.join(nestedNm, name);
      try {
        if (fs.statSync(child).isDirectory()) walkPackageDir(child);
      } catch {
        /* ignore */
      }
    }
  }

  const topLevel = path.join(nodeModules, 'xsd-schema-validator');
  if (fs.existsSync(path.join(topLevel, 'package.json'))) {
    found.push(topLevel);
  }

  for (const name of fs.readdirSync(nodeModules)) {
    if (name === 'xsd-schema-validator' || name.startsWith('.')) continue;
    const pkgDir = path.join(nodeModules, name);
    try {
      if (fs.statSync(pkgDir).isDirectory()) walkPackageDir(pkgDir);
    } catch {
      /* ignore */
    }
  }

  return [...new Set(found)];
}

function patchXsdStub() {
  const stubIndex = path.join(stubDir, 'index.js');
  const stubPkg = path.join(stubDir, 'package.json');
  if (!fs.existsSync(stubIndex)) {
    throw new Error('Stub xsd-schema-validator não encontrado em patches/.');
  }

  const targets = findXsdValidatorDirs();
  for (const target of targets) {
    fs.copyFileSync(stubIndex, path.join(target, 'index.js'));
    fs.copyFileSync(stubPkg, path.join(target, 'package.json'));
    const validatorJs = path.join(target, 'lib', 'validator.js');
    if (fs.existsSync(path.join(target, 'lib'))) {
      fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
      fs.copyFileSync(stubIndex, validatorJs);
    }
    const postInstall = path.join(target, 'lib', 'post-install.js');
    if (fs.existsSync(postInstall)) {
      fs.writeFileSync(postInstall, '/* skipped on serverless */\n');
    }
  }
  console.log(`[postinstall-deps] xsd-schema-validator patcheado em ${targets.length} local(is).`);
}

function run(cmd) {
  console.log(`[postinstall-deps] ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

run('npm install --ignore-scripts');
patchXsdStub();
try {
  run('npm rebuild libxmljs2');
} catch {
  console.warn('[postinstall-deps] npm rebuild libxmljs2 falhou; validação JS pode ainda funcionar.');
}
try {
  require('./bundle-icp-certs');
} catch (e) {
  console.warn('[postinstall-deps] bundle ICP-Brasil:', e.message);
}
try {
  require('./patch-nfewizard-shared');
} catch (e) {
  console.warn('[postinstall-deps] patch nfewizard:', e.message);
}
