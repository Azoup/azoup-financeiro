const path = require('path');
const fs = require('fs');

/**
 * Credenciais sandbox C6 Developers (homologação).
 * CNPJ cobrador = emitente 2 (não padrão) da NFS-e.
 */
const C6_SANDBOX = {
  client_id: '3cbe1db9-ee03-4f3b-aae4-b0ea2e649cee',
  client_secret: 'jHM5711Cz2O6RHVpD79QKlqyhJipDyGf',
  pix_chave: '46bbfecb-540d-457d-abfd-7ef140886d3c',
  ambiente: 'sandbox',
  billing_scheme: '21',
};

/**
 * Resolve caminhos dos certs mTLS.
 * Usa .txt (versionados) porque *.key/*.pem ficam fora do deploy no Hobby/gitignore.
 */
function bundledCertPaths() {
  const candidates = [
    {
      certPath: path.join(__dirname, 'certs', 'sandbox-crt.txt'),
      keyPath: path.join(__dirname, 'certs', 'sandbox-key.txt'),
    },
    {
      certPath: path.join(__dirname, 'certs', 'sandbox.crt'),
      keyPath: path.join(__dirname, 'certs', 'sandbox.key'),
    },
  ];
  for (const c of candidates) {
    if (fs.existsSync(c.certPath) && fs.existsSync(c.keyPath)) {
      return { ...c, fromDisk: true };
    }
  }
  throw new Error(
    'Certificados C6 sandbox ausentes em api/boleto/_lib/certs/ (sandbox-crt.txt / sandbox-key.txt).',
  );
}

module.exports = { C6_SANDBOX, bundledCertPaths };
