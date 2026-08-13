/**
 * Gera c6-evidencias-roteiro.txt com status + body para colar no Roteiro C6 v3.0.
 * Uso: node scripts/gerar-evidencias-c6.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { C6_SANDBOX, bundledCertPaths } = require('../api/boleto/_lib/c6SandboxDefaults.js');

const certs = bundledCertPaths();
const base = 'https://baas-api-sandbox.c6bank.info';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpsRequest(url, opts) {
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    const req = https.request(
      {
        protocol: p.protocol,
        hostname: p.hostname,
        port: 443,
        path: p.pathname + p.search,
        method: opts.method || 'GET',
        headers: opts.headers || {},
        agent: opts.agent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (opts.responseType === 'buffer') {
            resolve({
              status: res.statusCode,
              buffer: buf,
              contentType: res.headers['content-type'],
            });
            return;
          }
          const raw = buf.toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

async function main() {
  const agent = new https.Agent({
    cert: fs.readFileSync(certs.certPath),
    key: fs.readFileSync(certs.keyPath),
  });
  const lines = [];
  const add = (title, how, status, body, requestBody) => {
    lines.push('='.repeat(72));
    lines.push(title);
    lines.push('-'.repeat(72));
    lines.push(`COMO PEGAR: ${how}`);
    if (requestBody) {
      lines.push('');
      lines.push('Request enviado (referência):');
      lines.push(typeof requestBody === 'string' ? requestBody : pretty(requestBody));
    }
    lines.push('');
    lines.push('>>> Status Code - Retornado:');
    lines.push(String(status));
    lines.push('');
    lines.push('>>> Response Body - Retornado (cole no documento):');
    lines.push(typeof body === 'string' ? body : pretty(body));
    lines.push('');
  };

  const authBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: C6_SANDBOX.client_id,
    client_secret: C6_SANDBOX.client_secret,
  }).toString();
  const auth = await httpsRequest(`${base}/v1/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(authBody),
      'partner-software-name': 'SistemaJessica',
      'partner-software-version': '1.0.0',
    },
    body: authBody,
    agent,
  });
  const token = auth.json.access_token;
  if (!token) throw new Error(`Auth falhou: ${auth.raw}`);

  add(
    'AT_01 – GERAÇÃO DO TOKEN DE SESSÃO',
    'POST /v1/auth | Content-Type application/x-www-form-urlencoded | body grant_type + client_id + client_secret | mTLS (.crt+.key)',
    auth.status,
    {
      access_token: auth.json.access_token,
      expires_in: auth.json.expires_in,
      token_type: auth.json.token_type,
      scope: auth.json.scope,
    },
    {
      grant_type: 'client_credentials',
      client_id: C6_SANDBOX.client_id,
      client_secret: C6_SANDBOX.client_secret,
    },
  );

  const H = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'partner-software-name': 'SistemaJessica',
    'partner-software-version': '1.0.0',
  };
  const due = new Date();
  due.setDate(due.getDate() + 10);
  const dueStr = due.toISOString().slice(0, 10);
  const payer = {
    name: 'Cliente Homologacao',
    tax_id: '52998224725',
    address: {
      street: 'Rua Teste',
      number: 100,
      city: 'Sao Paulo',
      state: 'SP',
      zip_code: '01310100',
    },
  };
  const ext = () => `T${Date.now().toString().slice(-9)}`;

  const p1 = {
    external_reference_id: ext(),
    amount: 10.5,
    due_date: dueStr,
    payer,
  };
  const b1 = await httpsRequest(`${base}/v1/bank_slips`, {
    method: 'POST',
    headers: { ...H, 'Content-Length': Buffer.byteLength(JSON.stringify(p1)) },
    body: JSON.stringify(p1),
    agent,
  });
  add(
    'B_01 – EMISSÃO DE BOLETO SIMPLES',
    'POST /v1/bank_slips com external_reference_id (máx 10), amount, due_date, payer (address sem neighborhood; number numérico)',
    b1.status,
    b1.json,
    p1,
  );

  const p2 = {
    external_reference_id: ext(),
    amount: 20,
    due_date: dueStr,
    payer,
    interest: { value: 0.033 },
    fine: { value: 2 },
  };
  const b2 = await httpsRequest(`${base}/v1/bank_slips`, {
    method: 'POST',
    headers: { ...H, 'Content-Length': Buffer.byteLength(JSON.stringify(p2)) },
    body: JSON.stringify(p2),
    agent,
  });
  add(
    'B_02 – EMISSÃO COM JUROS E MULTA',
    'POST /v1/bank_slips + interest:{value:0.033} + fine:{value:2}',
    b2.status,
    b2.json,
    p2,
  );
  const id = b2.json?.id;
  if (!id) throw new Error('B_02 sem id');

  const p3 = {
    external_reference_id: ext(),
    amount: 30,
    due_date: dueStr,
    payer,
    discount: { first: { value: 1.5 } },
  };
  const b3 = await httpsRequest(`${base}/v1/bank_slips`, {
    method: 'POST',
    headers: { ...H, 'Content-Length': Buffer.byteLength(JSON.stringify(p3)) },
    body: JSON.stringify(p3),
    agent,
  });
  add(
    'B_03 – EMISSÃO COM DESCONTO',
    'POST /v1/bank_slips + discount:{first:{value:1.5}}',
    b3.status,
    b3.json,
    p3,
  );

  console.log('Aguardando CIP (~70s) para alteração/cancelamento...');
  await sleep(70000);

  const newDue = new Date();
  newDue.setDate(newDue.getDate() + 20);
  const nd = newDue.toISOString().slice(0, 10);
  const put = JSON.stringify({ due_date: nd });
  let b4 = await httpsRequest(`${base}/v1/bank_slips/${id}`, {
    method: 'PUT',
    headers: { ...H, 'Content-Length': Buffer.byteLength(put) },
    body: put,
    agent,
  });
  if (b4.status >= 400) {
    await sleep(40000);
    b4 = await httpsRequest(`${base}/v1/bank_slips/${id}`, {
      method: 'PUT',
      headers: { ...H, 'Content-Length': Buffer.byteLength(put) },
      body: put,
      agent,
    });
  }
  add(
    'B_04 – ALTERAÇÃO DE DADOS DO BOLETO',
    'PUT /v1/bank_slips/{id} body {"due_date":"AAAA-MM-DD"} — aguarde 1–2 min após emitir (CIP)',
    b4.status,
    b4.json || { raw: b4.raw },
    { due_date: nd, boleto_id: id },
  );

  const b5 = await httpsRequest(`${base}/v1/bank_slips/${id}`, {
    method: 'GET',
    headers: H,
    agent,
  });
  const b5body = { ...(b5.json || {}) };
  if (b5body.base64_pdf_file) b5body.base64_pdf_file = '(PDF base64 omitido — evidência em B_06)';
  add(
    'B_05 – CONSULTA DE BOLETO',
    'GET /v1/bank_slips/{id}',
    b5.status,
    b5body,
    { method: 'GET', path: `/v1/bank_slips/${id}` },
  );

  const b6 = await httpsRequest(`${base}/v1/bank_slips/${id}/pdf`, {
    method: 'GET',
    headers: H,
    agent,
    responseType: 'buffer',
  });
  add(
    'B_06 – GERAÇÃO DO PDF DO BOLETO',
    'GET /v1/bank_slips/{id}/pdf — no Postman: Save Response > Save to a file (.pdf)',
    b6.status,
    `PDF gerado com sucesso. Content-Type: ${b6.contentType}; tamanho: ${b6.buffer?.length} bytes. Endpoint: GET /v1/bank_slips/${id}/pdf`,
    { method: 'GET', path: `/v1/bank_slips/${id}/pdf` },
  );

  const whPayload = {
    url: 'https://sistema-jessica.vercel.app/api/boleto/webhook-sicoob?banco=c6',
    service: 'BANK_SLIP',
  };
  const wh = JSON.stringify(whPayload);
  const b7 = await httpsRequest(`${base}/v1/webhooks/`, {
    method: 'POST',
    headers: { ...H, 'Content-Length': Buffer.byteLength(wh) },
    body: wh,
    agent,
  });
  add(
    'B_07 – CADASTRO DO WEBHOOK',
    'POST /v1/webhooks/ body {"url":"...","service":"BANK_SLIP"}',
    b7.status,
    b7.json,
    whPayload,
  );

  let b8 = await httpsRequest(`${base}/v1/bank_slips/${id}/cancel`, {
    method: 'PUT',
    headers: H,
    agent,
  });
  if (b8.status >= 400) {
    await sleep(30000);
    b8 = await httpsRequest(`${base}/v1/bank_slips/${id}/cancel`, {
      method: 'PUT',
      headers: H,
      agent,
    });
  }
  add(
    'B_08 – BAIXA/CANCELAMENTO',
    'PUT /v1/bank_slips/{id}/cancel — se 400 CIP, espere e tente de novo',
    b8.status,
    b8.json || 'HTTP 204 No Content — boleto cancelado/baixado com sucesso (sem corpo na resposta).',
    { method: 'PUT', path: `/v1/bank_slips/${id}/cancel` },
  );

  const outPath = path.join(__dirname, '..', 'c6-evidencias-roteiro.txt');
  const header = [
    'EVIDÊNCIAS C6 DEVELOPERS — ROTEIRO v3.0',
    'Ambiente: sandbox | Host: ' + base,
    '',
    '========== FORMULÁRIO INICIAL (cole no Word) ==========',
    '1. CNPJ / IDENTIFICADOR DA ORGANIZAÇÃO:',
    '   (use o CNPJ da conta PJ / emitente 2 no C6 — o sandbox retornou originator_id 000006738687)',
    '2. NOME DA EMPRESA CLIENTE / PARCEIRA:',
    '   (razão social da empresa no C6)',
    '3. NOME DO SOFTWARE:',
    '   SistemaJessica',
    '4. RESPONSÁVEL PELA EMPRESA:',
    '   (seu nome)',
    '5. E-MAIL:',
    '   (seu e-mail de contato com o C6)',
    '6. TELEFONE:',
    '   (seu telefone)',
    '',
    'APIs MARCADAS NO CHECKBOX:',
    '   [X] 1 AUTENTICAÇÃO',
    '   [ ] 2 AGENDAMENTO DE PAGAMENTOS',
    '   [X] 3 BOLETO',
    '   [ ] 4 CHECKOUT',
    '   [ ] 5 EXTRATO',
    '   [ ] 6 PIX',
    '   [ ] 7 TRANSAÇÕES E RECEBÍVEIS',
    '   [ ] 8 PIX AUTOMÁTICO',
    '   [ ] 9 BOLEPIX',
    '',
    '========== CREDENCIAIS SANDBOX USADAS ==========',
    `client_id: ${C6_SANDBOX.client_id}`,
    `client_secret: ${C6_SANDBOX.client_secret}`,
    `pix_chave: ${C6_SANDBOX.pix_chave}`,
    `billing_scheme: ${C6_SANDBOX.billing_scheme}`,
    'certificado: api/boleto/_lib/certs/sandbox-crt.txt',
    'chave: api/boleto/_lib/certs/sandbox-key.txt',
    'partner-software-name: SistemaJessica',
    'partner-software-version: 1.0.0',
    '',
    '========== COMO USAR ==========',
    'Em cada teste abaixo, copie APENAS as duas linhas marcadas:',
    '  >>> Status Code - Retornado',
    '  >>> Response Body - Retornado',
    'e cole nos campos correspondentes do Word.',
    '',
  ];
  fs.writeFileSync(outPath, header.concat(lines).join('\n'), 'utf8');
  console.log('Arquivo gerado:', outPath);
  console.log('Resumo:', {
    AT_01: auth.status,
    B_01: b1.status,
    B_02: b2.status,
    B_03: b3.status,
    B_04: b4.status,
    B_05: b5.status,
    B_06: b6.status,
    B_07: b7.status,
    B_08: b8.status,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
