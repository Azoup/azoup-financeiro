const path = require('path');
const fs = require('fs');

/**
 * Credenciais C6 Bank — CNPJ cobrador: 05.320.214/0001-69
 */
const C6_CNPJ_COBRADOR = '05320214000169';

const C6_SANDBOX = {
  client_id: '3cbe1db9-ee03-4f3b-aae4-b0ea2e649cee',
  client_secret: 'jHM5711Cz2O6RHVpD79QKlqyhJipDyGf',
  pix_chave: '46bbfecb-540d-457d-abfd-7ef140886d3c',
  ambiente: 'sandbox',
  billing_scheme: '21',
};

const C6_PROD = {
  client_id: '5204f13e-ddca-4db5-8c1f-e463fa2d0623',
  client_secret: '994HNeachRXeiKg4RnHPJEiOUZFjucKb',
  pix_chave: '',
  ambiente: 'producao',
  billing_scheme: '15',
};

/** Defaults ativos (produção). */
const C6_ACTIVE = C6_PROD;

/**
 * Resolve caminhos dos certs mTLS.
 * Produção: prod-crt.txt / prod-key.txt (ou .crt/.key)
 * Sandbox: sandbox-crt.txt / sandbox-key.txt
 * Usa .txt porque *.key/*.pem ficam fora do deploy no Hobby/gitignore.
 */
function bundledCertPaths(ambiente) {
  // Sem argumento (scripts de evidência) → sandbox. API passa 'producao' | 'sandbox'.
  const isProd = String(ambiente || '') === 'producao';
  const candidates = isProd
    ? [
        {
          certPath: path.join(__dirname, 'certs', 'prod-crt.txt'),
          keyPath: path.join(__dirname, 'certs', 'prod-key.txt'),
        },
        {
          certPath: path.join(__dirname, 'certs', 'prod.crt'),
          keyPath: path.join(__dirname, 'certs', 'prod.key'),
        },
      ]
    : [
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
      return { ...c, fromDisk: true, ambiente: isProd ? 'producao' : 'sandbox' };
    }
  }

  if (isProd) {
    throw new Error(
      'Certificados C6 de PRODUÇÃO ausentes. Coloque prod-crt.txt e prod-key.txt em api/boleto/_lib/certs/ ' +
        '(baixe no portal Developers C6) ou faça upload em Configurações › Boleto C6.',
    );
  }
  throw new Error(
    'Certificados C6 sandbox ausentes em api/boleto/_lib/certs/ (sandbox-crt.txt / sandbox-key.txt).',
  );
}

module.exports = { C6_SANDBOX, C6_PROD, C6_ACTIVE, C6_CNPJ_COBRADOR, bundledCertPaths };
