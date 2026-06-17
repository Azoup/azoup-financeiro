const fs = require('fs');
const os = require('os');
const path = require('path');
const { decrypt } = require('./crypto');

async function loadNfseWizardClass() {
  try {
    const mod = await import('@nfewizard/nfse');
    return mod.default ?? mod.NFSe ?? mod;
  } catch {
    return null;
  }
}

async function downloadCertToTemp(admin, storagePath) {
  const { data, error } = await admin.storage.from('empresa_certificados').download(storagePath);
  if (error || !data) throw new Error('Não foi possível baixar o certificado A1.');
  const tmp = path.join(os.tmpdir(), `cert-nfse-${Date.now()}.pfx`);
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function cleanupCert(certPath) {
  try {
    if (certPath) fs.unlinkSync(certPath);
  } catch {
    /* ignore */
  }
}

/** Instancia @nfewizard/nfse com certificado temporário. */
async function createNfseWizard({ admin, cert, senhaEnc, perfil, ambiente = 2 }) {
  const NFSeWizard = await loadNfseWizardClass();
  if (!NFSeWizard) {
    throw new Error('Pacote @nfewizard/nfse não instalado no servidor.');
  }

  const senha = decrypt(senhaEnc);
  const certPath = await downloadCertToTemp(admin, cert.storage_path);
  const doc = onlyDigits(perfil.documento);
  const uf = String(perfil.uf ?? 'SP')
    .trim()
    .toUpperCase()
    .slice(0, 2);

  const amb = Number(ambiente) === 1 ? 1 : 2;

  const wizard = new NFSeWizard({
    dfe: {
      pathCertificado: certPath,
      senhaCertificado: senha,
      CPFCNPJ: doc,
      UF: uf,
      armazenarXMLAutorizacao: false,
      armazenarXMLRetorno: false,
    },
    nfse: {
      ambiente: amb,
      versao: '1.00',
    },
    nfe: {
      ambiente: amb,
      versaoDF: '1.0.0',
    },
    lib: {
      useForSchemaValidation: 'validateSchemaJsBased',
      log: { exibirLogNoConsole: false, armazenarLogs: false },
    },
  });

  return { wizard, certPath };
}

module.exports = { createNfseWizard, cleanupCert, onlyDigits };
