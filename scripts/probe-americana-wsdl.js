const https = require('https');
const fs = require('fs');

const url = 'https://nfse.americana.sp.gov.br/nfse/WSNacional2/nfse.asmx?wsdl';
https
  .get(url, { rejectUnauthorized: false }, (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      fs.writeFileSync('c:/NewDevelopment/SistemaJessica/tmp-americana.wsdl', d);
      console.log('status', res.statusCode, 'len', d.length);
      const ops = [...d.matchAll(/operation name="([^"]+)"/g)].map((m) => m[1]);
      console.log('ops', [...new Set(ops)]);
      const acts = [...d.matchAll(/soapAction="([^"]*)"/g)].map((m) => m[1]);
      console.log('actions', [...new Set(acts)]);
      const idx = d.indexOf('GerarNfse');
      console.log(d.substring(Math.max(0, idx - 100), idx + 900));
    });
  })
  .on('error', (e) => console.error(e));
