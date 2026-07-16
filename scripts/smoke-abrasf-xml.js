/** Smoke: montagem + assinatura ABRASF Americana (sem rede). */
const path = require('path');
const forge = require('node-forge');
const { itemListaServico, codigoCnae } = require('../api/nfe/_lib/nfseAbrasfAmericana');

// Reutiliza funções internas via require do módulo e assinatura local
const abrasf = require('../api/nfe/_lib/nfseAbrasfAmericana');

console.log('itemListaServico(010701)=', itemListaServico('010701'));
console.log('cnae default=', codigoCnae({}));

const keys = forge.pki.rsa.generateKeyPair(1024);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
cert.setSubject([{ name: 'commonName', value: 't' }]);
cert.setIssuer([{ name: 'commonName', value: 't' }]);
cert.sign(keys.privateKey, forge.md.sha1.create());

const { SignedXml } = require('xml-crypto');
const xml =
  '<GerarNfseEnvio xmlns="http://www.abrasf.org.br/nfse.xsd"><Rps>' +
  '<InfDeclaracaoPrestacaoServico Id="rps11"><Competencia>2026-07-01</Competencia>' +
  '</InfDeclaracaoPrestacaoServico></Rps></GerarNfseEnvio>';

const sig = new SignedXml({
  privateKey: forge.pki.privateKeyToPem(keys.privateKey),
  publicCert: forge.pki.certificateToPem(cert),
  signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  getKeyInfoContent: SignedXml.getKeyInfoContent,
});
sig.addReference({
  xpath: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
  transforms: [
    'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
    'http://www.w3.org/2001/10/xml-exc-c14n#',
  ],
  digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
});
sig.computeSignature(xml, {
  location: {
    reference: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
    action: 'after',
  },
});
const out = sig.getSignedXml();
const ok = /InfDeclaracaoPrestacaoServico[^>]*>[\s\S]*<\/InfDeclaracaoPrestacaoServico>\s*<Signature/.test(out);
console.log(ok ? 'signature sibling OK' : 'signature placement FAIL');
console.log('exports', Object.keys(abrasf).join(','));
console.log('cwd', path.basename(process.cwd()));
