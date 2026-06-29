const fs = require('fs');
const path = require('path');
const tls = require('tls');

let configured = false;

/** Confia na cadeia ICP-Brasil (SEFAZ / NFS-e nacional) no Node serverless. */
function configureTlsForSefaz() {
  if (configured) return;
  configured = true;

  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return;
  }

  try {
    const merged = [];
    const pushCerts = (source) => {
      try {
        const list = tls.getCACertificates(source);
        if (Array.isArray(list) && list.length) merged.push(...list);
      } catch {
        /* source indisponível neste runtime */
      }
    };

    pushCerts('bundled');
    pushCerts('default');
    pushCerts('system');

    const bundlePath = path.join(__dirname, 'icp-brasil-ca-bundle.pem');
    if (fs.existsSync(bundlePath)) {
      const pem = fs.readFileSync(bundlePath, 'utf8').trim();
      if (pem && !pem.startsWith('#')) {
        merged.push(pem);
      }
    }

    const systemBundle = '/etc/ssl/certs/ca-certificates.crt';
    if (fs.existsSync(systemBundle)) {
      merged.push(fs.readFileSync(systemBundle, 'utf8'));
    }

    if (merged.length) {
      tls.setDefaultCACertificates('default', merged);
    }
  } catch (e) {
    console.warn('configureTlsForSefaz:', e.message);
  }
}

module.exports = { configureTlsForSefaz };
