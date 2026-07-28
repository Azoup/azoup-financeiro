/**
 * Credenciais sandbox C6 Developers (homologação).
 * CNPJ cobrador = emitente 2 (não padrão) da NFS-e.
 */
const path = require('path');

const C6_SANDBOX = {
  client_id: '3cbe1db9-ee03-4f3b-aae4-b0ea2e649cee',
  client_secret: 'jHM5711Cz2O6RHVpD79QKlqyhJipDyGf',
  pix_chave: '46bbfecb-540d-457d-abfd-7ef140886d3c',
  ambiente: 'sandbox',
  billing_scheme: '21',
};

function bundledCertPaths() {
  return {
    certPath: path.join(__dirname, 'certs', 'sandbox.crt'),
    keyPath: path.join(__dirname, 'certs', 'sandbox.key'),
  };
}

module.exports = { C6_SANDBOX, bundledCertPaths };
