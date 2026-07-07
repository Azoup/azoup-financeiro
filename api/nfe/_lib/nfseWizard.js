const fs = require('fs');
const os = require('os');
const path = require('path');
const { decryptCertPassword } = require('./crypto');
const { prepareServerlessCryptoEnv, NFEWIZARD_LIB_SERVERLESS } = require('./serverlessEnv');

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
async function createNfseWizard({ admin, cert, senhaEnc, perfil, ambiente = 2, ibge }) {
  prepareServerlessCryptoEnv();

  const amb = Number(ambiente) === 1 ? 1 : 2;
  const { applyNfseGatewayEnv } = require('./nfseGateways');
  const gateway = applyNfseGatewayEnv(ibge ?? '', amb);

  const NFSeWizard = await loadNfseWizardClass();
  if (!NFSeWizard) {
    throw new Error('Pacote @nfewizard/nfse não instalado no servidor.');
  }

  const senha = await decryptCertPassword(admin, senhaEnc);
  const certPath = await downloadCertToTemp(admin, cert.storage_path);
  const doc = onlyDigits(perfil.documento);
  const uf = String(perfil.uf ?? 'SP')
    .trim()
    .toUpperCase()
    .slice(0, 2);

  const caCertsDir = path.join(__dirname, 'nfewizard-certs');
  if (fs.existsSync(caCertsDir)) {
    process.env.NFEWIZARD_CA_CERTS_DIR = caCertsDir;
  }

  const wizard = new NFSeWizard({
    dfe: {
      pathCertificado: certPath,
      senhaCertificado: senha,
      CPFCNPJ: doc,
      UF: uf,
      ambiente: amb,
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
      ...NFEWIZARD_LIB_SERVERLESS,
    },
  });

  return { wizard, certPath, gateway };
}

module.exports = { createNfseWizard, cleanupCert, onlyDigits };
