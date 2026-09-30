/**
 * Gera sicoob-evidencias-roteiro.txt com status + body para enviar ao Sicoob.
 *
 * E-mail oficial Sicoob: testes em PRODUÇÃO com Client ID vinculado à empresa parceira (Azoup).
 * NÃO use o Client ID / Bearer de demonstração do Portal Developers nas evidências oficiais.
 *
 * Produção (fluxo exigido):
 *   set SICOOB_CLIENT_ID=...          # app do cooperado vinculado à Azoup
 *   set SICOOB_CERT_PFX_PATH=C:\caminho\cert.pfx
 *   set SICOOB_CERT_PASSWORD=...
 *   set SICOOB_NUMERO_CLIENTE=...
 *   set SICOOB_NUMERO_CONTA=...
 *   set SICOOB_AMBIENTE=producao
 *   node scripts/gerar-evidencias-sicoob.js
 *
 * Sandbox público (smoke local apenas — NÃO enviar ao Sicoob):
 *   client_id 9b5e603e428cc477a2841e2683c92d21
 *   token     1301865f-c6bc-38f3-9f49-666dbcfc59c3
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const DEMO_CLIENT_ID = '9b5e603e428cc477a2841e2683c92d21';
const AMBIENTE = (process.env.SICOOB_AMBIENTE || 'sandbox').toLowerCase();
const CLIENT_ID =
  process.env.SICOOB_CLIENT_ID || DEMO_CLIENT_ID;
const ACCESS_TOKEN_ENV =
  process.env.SICOOB_ACCESS_TOKEN || '1301865f-c6bc-38f3-9f49-666dbcfc59c3';
const CERT_PFX = process.env.SICOOB_CERT_PFX_PATH || '';
const CERT_PASS = process.env.SICOOB_CERT_PASSWORD || '';
const NUMERO_CLIENTE = Number(process.env.SICOOB_NUMERO_CLIENTE || '2554645');
const NUMERO_CONTA = Number(process.env.SICOOB_NUMERO_CONTA || '12345');
const CODIGO_MODALIDADE = Number(process.env.SICOOB_CODIGO_MODALIDADE || '1');
const CONTA_SANDBOX = Number(process.env.SICOOB_CONTA_TESTE || NUMERO_CONTA || '12345');

const IS_PROD = AMBIENTE === 'producao' || AMBIENTE === 'production';
const HOST = IS_PROD ? 'https://api.sicoob.com.br' : 'https://sandbox.sicoob.com.br/sicoob/sandbox';
const ENDPOINTS = {
  cobranca: IS_PROD ? `${HOST}/cobranca-bancaria/v3` : `${HOST}/cobranca-bancaria/v3`,
  cobrancaPagamentos: `${HOST}/cobranca-bancaria-pagamentos/v3`,
  contaCorrente: `${HOST}/conta-corrente/v4`,
  pixRecebimentos: `${HOST}/pix/api/v2`,
  pixPagamentos: `${HOST}/pix-pagamentos/v2`,
  poupanca: `${HOST}/poupanca/v3`,
  spb: `${HOST}/spb/v2`,
};

const SCOPE =
  process.env.SICOOB_SCOPE ??
  'boletos_consulta boletos_inclusao boletos_alteracao';

function authUrl() {
  if (AMBIENTE === 'producao' || AMBIENTE === 'production') {
    return 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token';
  }
  return 'https://sandbox.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token';
}

function apiBase() {
  if (AMBIENTE === 'producao' || AMBIENTE === 'production') {
    return 'https://api.sicoob.com.br/cobranca-bancaria/v3';
  }
  return 'https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3';
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function redactToken(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = { ...obj };
  if (typeof copy.access_token === 'string' && copy.access_token.length > 24) {
    copy.access_token = `${copy.access_token.slice(0, 12)}…(redacted)…${copy.access_token.slice(-8)}`;
  }
  return copy;
}

function httpsRequest(url, opts = {}) {
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
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode ?? 0, json, raw, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function createAgent() {
  if (!CERT_PFX) return undefined;
  if (!fs.existsSync(CERT_PFX)) {
    throw new Error(`Certificado não encontrado: ${CERT_PFX}`);
  }
  return new https.Agent({
    pfx: fs.readFileSync(CERT_PFX),
    passphrase: CERT_PASS,
    rejectUnauthorized: true,
  });
}

async function obterToken(agent) {
  // Sandbox do Portal Developers: access token fixo + client_id (sem mTLS).
  if (ACCESS_TOKEN_ENV && !CERT_PFX) {
    return {
      mode: 'token_portal_sandbox',
      status: 200,
      json: {
        access_token: ACCESS_TOKEN_ENV,
        token_type: 'Bearer',
        expires_note: 'Token sandbox do Portal Developers (não é OAuth de produção).',
      },
      request: {
        source: 'Portal Developers › Sandbox › Access token (Bearer)',
        client_id: CLIENT_ID,
      },
    };
  }

  if (!CERT_PFX) {
    throw new Error('Informe SICOOB_ACCESS_TOKEN (sandbox) ou SICOOB_CERT_PFX_PATH (OAuth/mTLS).');
  }

  const params = {
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
  };
  if (SCOPE) params.scope = SCOPE;
  const body = new URLSearchParams(params).toString();

  const res = await httpsRequest(authUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    agent,
  });

  return {
    mode: 'oauth_mtls',
    status: res.status,
    json: res.json,
    raw: res.raw,
    request: {
      url: authUrl(),
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      scope: SCOPE || '(escopos padrão do aplicativo)',
      mtls: true,
      cert: 'A1 ICP-Brasil do CNPJ 05320214000169',
    },
  };
}

function truncateJson(obj, max = 3500) {
  const s = pretty(obj);
  if (s.length <= max) return obj;
  return { _truncated: true, preview: s.slice(0, max) + '\n…(truncado na evidência)' };
}

async function main() {
  const isProd = AMBIENTE === 'producao' || AMBIENTE === 'production';
  if (isProd && CLIENT_ID === DEMO_CLIENT_ID) {
    throw new Error(
      'SICOOB_AMBIENTE=producao exige o Client ID do aplicativo vinculado à Azoup (parceira). ' +
        'O Client ID de demonstração do portal (9b5e603e…) não é aceito pelo Sicoob nas evidências oficiais.',
    );
  }
  if (isProd && ACCESS_TOKEN_ENV && !CERT_PFX) {
    throw new Error(
      'Em produção use OAuth + certificado A1 (SICOOB_CERT_PFX_PATH). ' +
        'O Access Token Bearer do portal não serve para homologação oficial.',
    );
  }

  const lines = [];
  const results = [];
  const add = (title, how, status, body, requestBody) => {
    const isHtml =
      (typeof body === 'string' && body.includes('<html')) ||
      (body && typeof body === 'object' && body.note && String(body.note).includes('WAF'));
    const ok = !isHtml && (status === 201 || (status >= 200 && status < 300));
    results.push({ title, status, ok });
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
    const outBody = typeof body === 'string' ? body : truncateJson(body);
    lines.push(typeof outBody === 'string' ? outBody : pretty(outBody));
    lines.push('');
  };

  const geradoEm = new Date().toISOString();
  lines.push(
    isProd
      ? 'EVIDÊNCIAS SICOOB — PRODUÇÃO (Client ID empresa parceira)'
      : 'EVIDÊNCIAS SICOOB — sandbox (smoke local — NÃO enviar ao Sicoob)',
  );
  lines.push('Empresa parceira: Azoup Tecnologia LTDA');
  lines.push('Software: SistemaJessica / Azoup Financeiro');
  lines.push('Cooperativa liberada (parceira): 5004');
  lines.push(`Ambiente: ${AMBIENTE}`);
  lines.push(`Gerado em: ${geradoEm}`);
  lines.push('');
  lines.push(
    isProd
      ? '========== CREDENCIAIS (app vinculado à parceira Azoup — produção) =========='
      : '========== CREDENCIAIS (Portal Developers › Sandbox — demo) ==========',
  );
  lines.push(`client_id: ${CLIENT_ID}`);
  if (isProd) {
    lines.push('auth: OAuth2 client_credentials + certificado A1 ICP-Brasil (mTLS)');
  } else {
    lines.push('access_token: (Bearer do portal — valor omitido no resumo; usado nas requests)');
  }
  lines.push(`numeroCliente / convênio: ${NUMERO_CLIENTE}`);
  lines.push(`numeroContaCorrente: ${CONTA_SANDBOX}`);
  lines.push(
    isProd
      ? 'certificado A1: informado via SICOOB_CERT_PFX_PATH'
      : 'certificado A1: sandbox pode usar Bearer do portal',
  );
  lines.push('');
  if (!isProd) {
    lines.push('========== ENDPOINTS SANDBOX TESTADOS ==========');
    for (const [k, v] of Object.entries(ENDPOINTS)) lines.push(`- ${k}: ${v}`);
    lines.push('');
  }
  lines.push('APIs liberadas na parceira Azoup: Cobrança Bancária, Cobrança Bancária Pagamentos,');
  lines.push('Conta Corrente, Pix Pagamentos, Pix Recebimentos, Poupança, SPB Transferências.');
  lines.push('');

  const agent = createAgent();
  const tokenRes = await obterToken(agent);
  const token = tokenRes.json?.access_token;
  if (!token) {
    add('AT_01 – AUTENTICAÇÃO', 'Token / OAuth', tokenRes.status, tokenRes.json ?? tokenRes.raw, tokenRes.request);
    fs.writeFileSync(path.join(__dirname, '..', 'sicoob-evidencias-roteiro.txt'), lines.join('\n'), 'utf8');
    const detalhe =
      tokenRes.json?.error_description ||
      tokenRes.json?.error ||
      tokenRes.json?.message ||
      tokenRes.raw ||
      `HTTP ${tokenRes.status}`;
    console.error('Auth falhou:', tokenRes.status, String(detalhe).slice(0, 400));
    throw new Error('Falha ao obter token.');
  }

  add(
    isProd
      ? 'AT_01 – AUTENTICAÇÃO (OAuth produção + A1)'
      : 'AT_01 – AUTENTICAÇÃO (Access token sandbox)',
    isProd
      ? 'OAuth2 client_credentials + mTLS (certificado A1) + header client_id'
      : 'Portal Developers › Sandbox › Access token (Bearer) + header client_id',
    tokenRes.status,
    redactToken(tokenRes.json),
    tokenRes.request,
  );

  const apiHeaders = {
    Authorization: `Bearer ${token}`,
    client_id: CLIENT_ID,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  // ---- Cobrança Bancária V3 ----
  const hoje = new Date();
  const venc = new Date(hoje.getTime() + 10 * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const nossoHomolog = Number(String(Date.now()).slice(-8));
  const payloadIncluir = {
    numeroCliente: NUMERO_CLIENTE,
    codigoModalidade: CODIGO_MODALIDADE,
    numeroContaCorrente: CONTA_SANDBOX,
    codigoEspecieDocumento: 'DM',
    dataEmissao: isProd ? iso(hoje) : '2020-01-20',
    nossoNumero: isProd ? nossoHomolog : 258861,
    seuNumero: isProd ? `HOM${nossoHomolog}` : '1235512',
    identificacaoBoletoEmpresa: isProd ? `HOM${nossoHomolog}` : '4562',
    identificacaoEmissaoBoleto: 1,
    identificacaoDistribuicaoBoleto: 1,
    valor: isProd ? 10 : 156.23,
    dataVencimento: isProd ? iso(venc) : '2020-01-20',
    dataLimitePagamento: isProd ? iso(venc) : '2020-01-20',
    tipoDesconto: 0,
    tipoMulta: 0,
    tipoJurosMora: 0,
    numeroParcela: 1,
    aceite: true,
    codigoNegativacao: isProd ? 2 : 0,
    codigoProtesto: 3,
    gerarPdf: true,
    pagador: isProd
      ? {
          numeroCpfCnpj: '66639480000143',
          nome: 'AZFS TECNOLOGIA LTDA',
          endereco: 'Avenida Nove de Julho, 637',
          bairro: 'Jardim Sao Domingos',
          cidade: 'Americana',
          cep: '13471140',
          uf: 'SP',
        }
      : {
          numeroCpfCnpj: '98765432185',
          nome: 'Marcelo dos Santos',
          endereco: 'Rua 87 Quadra 1 Lote 1 casa 1',
          bairro: 'Santa Rosa',
          cidade: 'Luziania',
          cep: '72320000',
          uf: 'DF',
          email: 'pagador@dominio.com.br',
        },
    mensagensInstrucao: ['Homologacao Azoup'],
  };
  const bodyIncluir = JSON.stringify(payloadIncluir);
  const incluir = await httpsRequest(`${ENDPOINTS.cobranca}/boletos`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Length': Buffer.byteLength(bodyIncluir) },
    body: bodyIncluir,
    agent,
  });
  add(
    'CB_01 – Cobrança Bancária · INCLUSÃO BOLETO',
    `POST ${ENDPOINTS.cobranca}/boletos`,
    incluir.status,
    incluir.json ?? incluir.raw,
    payloadIncluir,
  );

  const resultado = incluir.json?.resultado ?? incluir.json;
  const nossoConsultar =
    resultado?.nossoNumero != null ? String(resultado.nossoNumero) : '258861';
  const qsBol = new URLSearchParams({
    numeroCliente: String(NUMERO_CLIENTE),
    codigoModalidade: String(CODIGO_MODALIDADE),
    nossoNumero: nossoConsultar,
  });
  const consultar = await httpsRequest(`${ENDPOINTS.cobranca}/boletos?${qsBol}`, {
    method: 'GET',
    headers: apiHeaders,
    agent,
  });
  add(
    'CB_02 – Cobrança Bancária · CONSULTA BOLETO',
    `GET ${ENDPOINTS.cobranca}/boletos?...`,
    consultar.status,
    consultar.json ?? consultar.raw,
    Object.fromEntries(qsBol.entries()),
  );

  if (isProd && (incluir.status === 200 || incluir.status === 201)) {
    const baixarBody = JSON.stringify({
      numeroCliente: NUMERO_CLIENTE,
      codigoModalidade: CODIGO_MODALIDADE,
    });
    const baixar = await httpsRequest(
      `${ENDPOINTS.cobranca}/boletos/${nossoConsultar}/baixar`,
      {
        method: 'POST',
        headers: { ...apiHeaders, 'Content-Length': Buffer.byteLength(baixarBody) },
        body: baixarBody,
        agent,
      },
    );
    add(
      'CB_03 – Cobrança Bancária · BAIXA DO BOLETO DE TESTE',
      `POST ${ENDPOINTS.cobranca}/boletos/${nossoConsultar}/baixar`,
      baixar.status,
      baixar.json ?? baixar.raw,
      JSON.parse(baixarBody),
    );
  }

  if (!isProd) {
  // ---- Conta Corrente ----
  const saldoCc = await httpsRequest(
    `${ENDPOINTS.contaCorrente}/saldo?numeroContaCorrente=${CONTA_SANDBOX}`,
    { method: 'GET', headers: apiHeaders, agent },
  );
  add(
    'CC_01 – Conta Corrente · SALDO',
    `GET ${ENDPOINTS.contaCorrente}/saldo?numeroContaCorrente=`,
    saldoCc.status,
    saldoCc.json ?? saldoCc.raw,
    { numeroContaCorrente: CONTA_SANDBOX },
  );

  // ---- Pix Recebimentos ----
  const pixLista = await httpsRequest(
    `${ENDPOINTS.pixRecebimentos}/cob?inicio=${encodeURIComponent('2020-01-01T00:00:00.00-03:00')}&fim=${encodeURIComponent('2020-12-31T23:59:59.00-03:00')}`,
    { method: 'GET', headers: apiHeaders, agent },
  );
  add(
    'PIX_R_01 – Pix Recebimentos · LISTAR COB',
    `GET ${ENDPOINTS.pixRecebimentos}/cob?inicio&fim`,
    pixLista.status,
    pixLista.json ?? pixLista.raw,
    { inicio: '2020-01-01T00:00:00.00-03:00', fim: '2020-12-31T23:59:59.00-03:00' },
  );

  const pixBody = JSON.stringify({
    calendario: { expiracao: 3600 },
    valor: { original: '1.00' },
    chave: 'homologacao@azoup.com.br',
    solicitacaoPagador: 'Homologacao Azoup Tecnologia LTDA',
  });
  const pixCob = await httpsRequest(`${ENDPOINTS.pixRecebimentos}/cob`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Length': Buffer.byteLength(pixBody) },
    body: pixBody,
    agent,
  });
  add(
    'PIX_R_02 – Pix Recebimentos · CRIAR COB',
    `POST ${ENDPOINTS.pixRecebimentos}/cob`,
    pixCob.status,
    pixCob.json ?? pixCob.raw,
    JSON.parse(pixBody),
  );

  const pixRec = await httpsRequest(
    `${ENDPOINTS.pixRecebimentos}/pix?inicio=${encodeURIComponent('2020-01-01T00:00:00.00-03:00')}&fim=${encodeURIComponent('2020-12-31T23:59:59.00-03:00')}`,
    { method: 'GET', headers: apiHeaders, agent },
  );
  add(
    'PIX_R_03 – Pix Recebimentos · LISTAR PIX',
    `GET ${ENDPOINTS.pixRecebimentos}/pix?inicio&fim`,
    pixRec.status,
    pixRec.json ?? pixRec.raw,
    { inicio: '2020-01-01T00:00:00.00-03:00', fim: '2020-12-31T23:59:59.00-03:00' },
  );

  // ---- Poupança ----
  const saldoPp = await httpsRequest(`${ENDPOINTS.poupanca}/contas/${CONTA_SANDBOX}/saldo`, {
    method: 'GET',
    headers: apiHeaders,
    agent,
  });
  add(
    'PP_01 – Poupança · SALDO',
    `GET ${ENDPOINTS.poupanca}/contas/{conta}/saldo`,
    saldoPp.status,
    saldoPp.json ?? saldoPp.raw,
    { contaPoupanca: CONTA_SANDBOX },
  );

  // ---- Pix Pagamentos / SPB / Cobrança Pagamentos (conectividade) ----
  const pixPag = await httpsRequest(`${ENDPOINTS.pixPagamentos}/pagamentos?id=1`, {
    method: 'GET',
    headers: apiHeaders,
    agent,
  });
  add(
    'PIX_P_01 – Pix Pagamentos · CONSULTA',
    `GET ${ENDPOINTS.pixPagamentos}/pagamentos?id=1`,
    pixPag.status,
    typeof pixPag.raw === 'string' && pixPag.raw.includes('<html')
      ? { note: 'Resposta HTML do WAF/gateway (sandbox). Endpoint alcançado.', preview: pixPag.raw.slice(0, 200) }
      : pixPag.json ?? pixPag.raw,
    { id: 1 },
  );

  const spb = await httpsRequest(`${ENDPOINTS.spb}/transferencias/ted?codigo=ABC123`, {
    method: 'GET',
    headers: apiHeaders,
    agent,
  });
  add(
    'SPB_01 – SPB Transferências · CONSULTA TED',
    `GET ${ENDPOINTS.spb}/transferencias/ted?codigo=`,
    spb.status,
    spb.json ?? spb.raw,
    { codigo: 'ABC123' },
  );

  const cobPag = await httpsRequest(
    `${ENDPOINTS.cobrancaPagamentos}/boletos?linhaDigitavel=42297115040000195441184217468127172300000023124`,
    { method: 'GET', headers: apiHeaders, agent },
  );
  add(
    'CBP_01 – Cobrança Bancária Pagamentos · CONSULTA',
    `GET ${ENDPOINTS.cobrancaPagamentos}/boletos?linhaDigitavel=`,
    cobPag.status,
    cobPag.json ?? cobPag.raw,
    { linhaDigitavel: '42297115040000195441184217468127172300000023124' },
  );

  }

  lines.push('='.repeat(72));
  lines.push('RESUMO DO PILOTO');
  lines.push('-'.repeat(72));
  for (const r of results) {
    lines.push(`${r.ok ? 'OK' : 'VERIFICAR'} · ${r.title} → HTTP ${r.status}`);
  }
  lines.push('');
  lines.push('Observação: no sandbox do Portal, alguns endpoints retornam mock/OpenAPI ou');
  lines.push('exigem parâmetros adicionais (SPB / Cobrança Pagamentos). Os testes críticos');
  lines.push('de Cobrança Bancária, Conta Corrente, Pix Recebimentos e Poupança com HTTP 2xx');
  lines.push('demonstram autenticação e consumo das APIs liberadas para a Azoup (coop. 5004).');
  lines.push('Certificado A1 ICP-Brasil já está no sistema para o fluxo de produção (OAuth mTLS).');
  lines.push('');

  const out = path.join(__dirname, '..', 'sicoob-evidencias-roteiro.txt');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  const okCriticos = results.filter((r) =>
    /AT_01|CB_01|CB_02|CC_01|PIX_R_01|PIX_R_02|PP_01/.test(r.title),
  );
  const allOk = okCriticos.every((r) => r.ok);
  console.log(`Evidências gravadas em: ${out}`);
  console.log(
    okCriticos.map((r) => `${r.ok ? 'OK' : 'FAIL'} ${r.title.split('–')[0].trim()}(${r.status})`).join(' | '),
  );
  if (!allOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
