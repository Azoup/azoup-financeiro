const path = require('path');
const fs = require('fs');

/**
 * Credenciais C6 Bank — CNPJs cobradores (portal C6).
 * Preferir credenciais salvas em Configurações › Boleto C6.
 */
const C6_CNPJ_COBRADOR = '05320214000169';
const C6_CNPJ_AZFS = '66639480000143';
const C6_CNPJS_COBRADOR = [C6_CNPJ_COBRADOR, C6_CNPJ_AZFS];

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

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function isAzfsCnpj(documento) {
  return onlyDigits(documento) === C6_CNPJ_AZFS;
}

/**
 * Resolve caminhos dos certs mTLS.
 * @param {'sandbox'|'producao'|string} ambiente
 * @param {{ cnpj?: string|null }} [opts] — se CNPJ AZFS, usa azfs-*.txt
 */
function bundledCertPaths(ambiente, opts = {}) {
  const isProd = String(ambiente || '') === 'producao';
  const azfs = isAzfsCnpj(opts.cnpj);

  const candidates = [];
  if (isProd && azfs) {
    candidates.push(
      {
        certPath: path.join(__dirname, 'certs', 'azfs-crt.txt'),
        keyPath: path.join(__dirname, 'certs', 'azfs-key.txt'),
        profile: 'azfs',
      },
      {
        certPath: path.join(__dirname, 'certs', 'azfs.crt'),
        keyPath: path.join(__dirname, 'certs', 'azfs.key'),
        profile: 'azfs',
      },
    );
  }
  if (isProd) {
    candidates.push(
      {
        certPath: path.join(__dirname, 'certs', 'prod-crt.txt'),
        keyPath: path.join(__dirname, 'certs', 'prod-key.txt'),
        profile: 'prod',
      },
      {
        certPath: path.join(__dirname, 'certs', 'prod.crt'),
        keyPath: path.join(__dirname, 'certs', 'prod.key'),
        profile: 'prod',
      },
    );
  } else {
    candidates.push(
      {
        certPath: path.join(__dirname, 'certs', 'sandbox-crt.txt'),
        keyPath: path.join(__dirname, 'certs', 'sandbox-key.txt'),
        profile: 'sandbox',
      },
      {
        certPath: path.join(__dirname, 'certs', 'sandbox.crt'),
        keyPath: path.join(__dirname, 'certs', 'sandbox.key'),
        profile: 'sandbox',
      },
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c.certPath) && fs.existsSync(c.keyPath)) {
      return {
        ...c,
        fromDisk: true,
        ambiente: isProd ? 'producao' : 'sandbox',
      };
    }
  }

  if (isProd && azfs) {
    throw new Error(
      'Certificados C6 AZFS ausentes. Coloque azfs-crt.txt e azfs-key.txt em api/boleto/_lib/certs/ ' +
        'ou envie .crt+.key em Configurações › Boleto C6 para o CNPJ 66.639.480/0001-43.',
    );
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

module.exports = {
  C6_SANDBOX,
  C6_PROD,
  C6_ACTIVE,
  C6_CNPJ_COBRADOR,
  C6_CNPJ_AZFS,
  C6_CNPJS_COBRADOR,
  onlyDigits,
  isAzfsCnpj,
  bundledCertPaths,
};
