const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function apiBaseUrl(ambiente) {
  if (ambiente === 'sandbox') {
    return 'https://baas-api-sandbox.c6bank.info';
  }
  return 'https://baas-api.c6bank.info';
}

function httpsRequest(url, { method = 'GET', headers = {}, body, agent, responseType = 'json' }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        agent,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (responseType === 'buffer') {
            resolve({ status: res.statusCode ?? 0, buffer: buf, headers: res.headers });
            return;
          }
          const raw = buf.toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode ?? 0, json, raw });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function createMtlsAgent(certPath, keyPath) {
  return new https.Agent({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    rejectUnauthorized: true,
  });
}

async function downloadC6FileToTemp(admin, storagePath, suffix) {
  const { data, error } = await admin.storage.from('c6_certs').download(storagePath);
  if (error || !data) throw new Error(`Não foi possível baixar o certificado C6 (${suffix}).`);
  const tmp = path.join(os.tmpdir(), `c6-${suffix}-${Date.now()}`);
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function cleanupTemp(filePath) {
  try {
    if (filePath) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

async function getC6AccessToken({ config, certPath, keyPath }) {
  const agent = createMtlsAgent(certPath, keyPath);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.client_id,
    client_secret: config.client_secret,
  }).toString();

  const res = await httpsRequest(`${apiBaseUrl(config.ambiente)}/v1/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'partner-software-name': 'SistemaJessica',
      'partner-software-version': '1.0.0',
    },
    body,
    agent,
  });

  const token = res.json?.access_token ?? res.json?.body?.access_token;
  if (res.status < 200 || res.status >= 300 || !token) {
    const msg =
      res.json?.error_description ??
      res.json?.message ??
      res.json?.error ??
      res.raw ??
      `Falha ao obter token C6 (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return token;
}

function splitInstrucoes(instrucoes) {
  return String(instrucoes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

/** C6: amount em reais (ex.: 150.50), mín. R$ 5,00, máx. R$ 500.000,00. */
const C6_AMOUNT_MIN = 5;
const C6_AMOUNT_MAX = 500000;

function normalizeC6Amount(raw) {
  if (raw == null || raw === '') return NaN;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : NaN;
  }
  let s = String(raw).trim();
  if (!s) return NaN;
  if (/^R\$\s*/i.test(s)) s = s.replace(/^R\$\s*/i, '').trim();
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function assertC6Amount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      'Valor do boleto inválido ou zerado. Confira o valor da mensalidade/parcela antes de registrar no C6.',
    );
  }
  if (amount < C6_AMOUNT_MIN) {
    throw new Error(
      `O C6 Bank exige valor mínimo de R$ 5,00 por boleto. Valor informado: R$ ${amount.toFixed(2).replace('.', ',')}.`,
    );
  }
  if (amount > C6_AMOUNT_MAX) {
    throw new Error(`Valor máximo do boleto C6: R$ ${C6_AMOUNT_MAX.toFixed(2).replace('.', ',')}.`);
  }
  return amount;
}

function resolveC6AmountFromBoleto(boleto) {
  return assertC6Amount(normalizeC6Amount(boleto?.valor_documento));
}

function extractC6ApiError(res) {
  const j = res.json;
  if (j?.detail && typeof j.detail === 'string') return j.detail;
  if (j?.title && j?.detail) return `${j.title} ${j.detail}`;
  if (j?.message) return j.message;
  if (j?.error_description) return j.error_description;
  if (j?.error) return typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
  if (Array.isArray(j?.errors)) return JSON.stringify(j.errors);
  if (typeof j === 'string') return j;
  return res.raw ?? `C6 rejeitou a requisição (${res.status}).`;
}

function parseAddressNumber(raw) {
  const digits = onlyDigits(raw);
  if (digits) {
    const n = Number(digits.slice(0, 6));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Schema sandbox C6 (v1/bank_slips):
 * - external_reference_id: ^[a-zA-Z0-9]{1,10}$
 * - our_number: até 10 dígitos
 * - payer.address: street, number (número), city, state, zip_code (sem neighborhood)
 * - interest/fine: { value: number }
 */
function buildC6Payload({ boleto, config, cliente }) {
  const taxId = onlyDigits(cliente.cnpj ?? cliente.cpf ?? cliente.documento ?? '');
  if (!taxId) throw new Error('Cliente sem CPF/CNPJ válido para emissão de boleto C6.');

  const name = (cliente.nome_fantasia ?? cliente.nome ?? cliente.razao_social ?? 'Pagador').trim();
  const street = (cliente.logradouro ?? 'Nao informado').trim() || 'Nao informado';
  let city = (cliente.cidade ?? 'Nao informado').trim() || 'Nao informado';
  if (city.length < 3) city = 'Nao informado';
  const state = String(cliente.uf ?? cliente.estado ?? 'SP')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const zip = onlyDigits(cliente.cep ?? '00000000').padStart(8, '0').slice(0, 8);

  const ourNumber = onlyDigits(boleto.nosso_numero || boleto.id).slice(-10) || '1';
  // C6 exige no máx. 10 alfanuméricos e únicos por cliente
  const externalId = String(boleto.numero_documento || boleto.id.replace(/-/g, ''))
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-10);
  if (!externalId) {
    throw new Error('Não foi possível montar external_reference_id do boleto C6.');
  }

  const billing =
    String(config.billing_scheme || '').trim() ||
    (config.ambiente === 'producao' ? '15' : '21');

  const instructions = splitInstrucoes(boleto.instrucoes);
  if (!instructions.length) instructions.push('Pagamento referente a servicos prestados.');

  const address = {
    street: street.slice(0, 100),
    number: parseAddressNumber(cliente.numero),
    city: city.slice(0, 50),
    state,
    zip_code: zip,
  };
  const complement = (cliente.complemento ?? '').trim();
  if (complement) address.complement = complement.slice(0, 50);

  const payload = {
    external_reference_id: externalId,
    amount: resolveC6AmountFromBoleto(boleto),
    due_date: String(boleto.data_vencimento).slice(0, 10),
    instructions,
    billing_scheme: String(billing),
    our_number: String(ourNumber),
    payer: {
      name: name.slice(0, 100),
      tax_id: taxId,
      address,
    },
  };

  const email = (cliente.email ?? cliente.email_contato ?? '').trim();
  if (email) payload.payer.email = email;

  return payload;
}

function extractC6BoletoResponse(json) {
  const result = json?.body ?? json?.data ?? json;
  return {
    id: result?.id ?? result?.bank_slip_id ?? result?.uuid ?? null,
    linha_digitavel:
      result?.digitable_line ?? result?.linha_digitavel ?? result?.digitableLine ?? null,
    codigo_barras: result?.bar_code ?? result?.barcode ?? result?.barCode ?? result?.codigo_barras ?? null,
    nosso_numero_banco:
      result?.our_number != null
        ? String(result.our_number)
        : result?.ourNumber != null
          ? String(result.ourNumber)
          : null,
    status: result?.status ?? result?.situation ?? null,
    raw: result,
  };
}

function isC6BoletoLiquidado(resultado) {
  const status = String(
    resultado?.status ?? resultado?.situation ?? resultado?.state ?? '',
  ).toLowerCase();
  return (
    status.includes('paid') ||
    status.includes('pago') ||
    status.includes('liquid') ||
    status.includes('settled') ||
    status === 'done'
  );
}

function extractC6DataPagamento(resultado) {
  const raw =
    resultado?.payment_date ??
    resultado?.paid_at ??
    resultado?.settlement_date ??
    resultado?.data_pagamento ??
    new Date().toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

function extractC6ValorPago(resultado, fallback) {
  const v = Number(
    resultado?.amount_paid ?? resultado?.paid_amount ?? resultado?.amount ?? fallback,
  );
  return Number.isFinite(v) && v > 0 ? v : Number(fallback);
}

async function emitirBoletoC6Api({ config, certPath, keyPath, payload }) {
  const token = await getC6AccessToken({ config, certPath, keyPath });
  const agent = createMtlsAgent(certPath, keyPath);
  const body = JSON.stringify(payload);

  const res = await httpsRequest(`${apiBaseUrl(config.ambiente)}/v1/bank_slips`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'partner-software-name': 'SistemaJessica',
      'partner-software-version': '1.0.0',
    },
    body,
    agent,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(extractC6ApiError(res));
  }

  return extractC6BoletoResponse(res.json);
}

async function consultarBoletoC6Api({ config, certPath, keyPath, c6BoletoId }) {
  if (!c6BoletoId) throw new Error('Boleto sem ID C6 para consulta.');
  const token = await getC6AccessToken({ config, certPath, keyPath });
  const agent = createMtlsAgent(certPath, keyPath);

  const res = await httpsRequest(`${apiBaseUrl(config.ambiente)}/v1/bank_slips/${c6BoletoId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'partner-software-name': 'SistemaJessica',
      'partner-software-version': '1.0.0',
    },
    agent,
  });

  if (res.status < 200 || res.status >= 300) {
    const msg =
      res.json?.message ?? res.raw ?? `Consulta C6 falhou (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  const resultado = extractC6BoletoResponse(res.json).raw ?? res.json;
  return {
    liquidado: isC6BoletoLiquidado(resultado),
    resultado,
    dataPagamento: extractC6DataPagamento(resultado),
    valorPago: extractC6ValorPago(resultado, null),
  };
}

async function obterPdfBoletoC6Api({ config, certPath, keyPath, c6BoletoId }) {
  if (!c6BoletoId) throw new Error('Boleto sem ID C6 para PDF.');
  const token = await getC6AccessToken({ config, certPath, keyPath });
  const agent = createMtlsAgent(certPath, keyPath);

  const res = await httpsRequest(`${apiBaseUrl(config.ambiente)}/v1/bank_slips/${c6BoletoId}/pdf`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'partner-software-name': 'SistemaJessica',
      'partner-software-version': '1.0.0',
    },
    agent,
    responseType: 'buffer',
  });

  if (res.status < 200 || res.status >= 300 || !res.buffer?.length) {
    throw new Error(`PDF C6 indisponível (${res.status}).`);
  }
  return res.buffer;
}

function partnerHeaders(token, withJson = false) {
  const h = {
    Authorization: `Bearer ${token}`,
    'partner-software-name': 'SistemaJessica',
    'partner-software-version': '1.0.0',
  };
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}

/** Txid Pix BACEN: 26–35 alfanuméricos. */
function makePixTxid(seed) {
  const raw = `SJ${String(seed || '')}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    .replace(/[^a-zA-Z0-9]/g, '');
  return (raw + 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX').slice(0, 26);
}

function formatPixValor(valor) {
  return Number(Number(valor).toFixed(2)).toFixed(2);
}

function buildPixDevedor(cliente) {
  const taxId = onlyDigits(cliente?.cnpj ?? cliente?.cpf ?? cliente?.documento ?? '');
  const nome = (cliente?.nome_fantasia ?? cliente?.nome ?? cliente?.razao_social ?? 'Pagador').trim();
  if (!taxId) return { nome };
  if (taxId.length > 11) return { nome, cnpj: taxId };
  return { nome, cpf: taxId.padStart(11, '0').slice(0, 11) };
}

async function c6PixRequest({ config, certPath, keyPath, method, path, body }) {
  const token = await getC6AccessToken({ config, certPath, keyPath });
  const agent = createMtlsAgent(certPath, keyPath);
  const payload = body != null ? JSON.stringify(body) : undefined;
  const headers = partnerHeaders(token, Boolean(payload));
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

  const res = await httpsRequest(`${apiBaseUrl(config.ambiente)}${path}`, {
    method,
    headers,
    body: payload,
    agent,
  });
  return res;
}

/** Cobrança Pix imediata (POST /v2/pix/cob ou PUT /v2/pix/cob/{txid}). */
async function criarPixCobC6Api({ config, certPath, keyPath, valor, chave, txid, expiracao = 3600, cliente, solicitacao }) {
  const pixChave = (chave || config.pix_chave || '').trim();
  if (!pixChave) throw new Error('Chave Pix C6 ausente.');

  const body = {
    calendario: { expiracao },
    valor: { original: formatPixValor(valor) },
    chave: pixChave,
    solicitacaoPagador: (solicitacao || 'Pagamento via Pix').slice(0, 140),
  };
  const devedor = buildPixDevedor(cliente || {});
  if (devedor.cpf || devedor.cnpj) body.devedor = devedor;

  const id = txid || makePixTxid(valor);
  const res = await c6PixRequest({
    config,
    certPath,
    keyPath,
    method: 'PUT',
    path: `/v2/pix/cob/${id}`,
    body,
  });

  // Fallback POST sem txid
  if (res.status >= 400) {
    const res2 = await c6PixRequest({
      config,
      certPath,
      keyPath,
      method: 'POST',
      path: '/v2/pix/cob',
      body,
    });
    if (res2.status < 200 || res2.status >= 300) {
      const msg = res2.json?.detail || res2.json?.title || res2.raw || `Pix cob falhou (${res2.status}).`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return { ...res2.json, httpStatus: res2.status, txid: res2.json?.txid || id };
  }

  if (res.status < 200 || res.status >= 300) {
    const msg = res.json?.detail || res.json?.title || res.raw || `Pix cob falhou (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return { ...res.json, httpStatus: res.status, txid: res.json?.txid || id };
}

/** Cobrança Pix com vencimento (PUT /v2/pix/cobv/{txid}). */
async function criarPixCobvC6Api({
  config,
  certPath,
  keyPath,
  valor,
  chave,
  dataVencimento,
  cliente,
  solicitacao,
  txid,
  validadeAposVencimento = 30,
}) {
  const pixChave = (chave || config.pix_chave || '').trim();
  if (!pixChave) throw new Error('Chave Pix C6 ausente.');
  const id = txid || makePixTxid(dataVencimento);
  const body = {
    calendario: {
      dataDeVencimento: String(dataVencimento).slice(0, 10),
      validadeAposVencimento,
    },
    valor: { original: formatPixValor(valor) },
    chave: pixChave,
    solicitacaoPagador: (solicitacao || 'Pagamento via Pix').slice(0, 140),
    devedor: buildPixDevedor(cliente || {}),
  };

  const res = await c6PixRequest({
    config,
    certPath,
    keyPath,
    method: 'PUT',
    path: `/v2/pix/cobv/${id}`,
    body,
  });
  if (res.status < 200 || res.status >= 300) {
    const msg = res.json?.detail || res.json?.title || res.raw || `Pix cobv falhou (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return { ...res.json, httpStatus: res.status, txid: res.json?.txid || id };
}

async function consultarPixC6Api({ config, certPath, keyPath, txid, comVencimento = false }) {
  if (!txid) throw new Error('txid Pix obrigatório.');
  const path = comVencimento ? `/v2/pix/cobv/${txid}` : `/v2/pix/cob/${txid}`;
  const res = await c6PixRequest({ config, certPath, keyPath, method: 'GET', path });
  if (res.status < 200 || res.status >= 300) {
    const msg = res.json?.detail || res.raw || `Consulta Pix falhou (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  const status = String(res.json?.status || '').toUpperCase();
  return {
    resultado: res.json,
    liquidado: status === 'CONCLUIDA',
    txid,
  };
}

async function revisarPixCobC6Api({ config, certPath, keyPath, txid, patchBody }) {
  const res = await c6PixRequest({
    config,
    certPath,
    keyPath,
    method: 'PATCH',
    path: `/v2/pix/cob/${txid}`,
    body: patchBody,
  });
  if (res.status < 200 || res.status >= 300) {
    const msg = res.json?.detail || res.raw || `Revisão Pix falhou (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res.json;
}

async function listarRecebiveisC6Api({ config, certPath, keyPath, startDate, endDate, page = 1, size = 50 }) {
  const qs = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    page: String(page),
    size: String(size),
  });
  const res = await c6PixRequest({
    config,
    certPath,
    keyPath,
    method: 'GET',
    path: `/v1/c6pay/statement/receivables?${qs}`,
  });
  if (res.status < 200 || res.status >= 300) {
    const msg = res.json?.detail || res.raw || `Recebíveis C6 falhou (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res.json;
}

async function listarTransacoesC6Api({ config, certPath, keyPath, startDate, endDate, page = 1, size = 50 }) {
  const qs = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    page: String(page),
    size: String(size),
  });
  const res = await c6PixRequest({
    config,
    certPath,
    keyPath,
    method: 'GET',
    path: `/v1/c6pay/statement/transactions?${qs}`,
  });
  if (res.status < 200 || res.status >= 300) {
    const msg = res.json?.detail || res.raw || `Transações C6 falhou (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res.json;
}

module.exports = {
  apiBaseUrl,
  assertC6Amount,
  buildC6Payload,
  C6_AMOUNT_MIN,
  C6_AMOUNT_MAX,
  cleanupTemp,
  consultarBoletoC6Api,
  consultarPixC6Api,
  createMtlsAgent,
  criarPixCobC6Api,
  criarPixCobvC6Api,
  downloadC6FileToTemp,
  emitirBoletoC6Api,
  extractC6ApiError,
  extractC6DataPagamento,
  extractC6ValorPago,
  getC6AccessToken,
  isC6BoletoLiquidado,
  listarRecebiveisC6Api,
  listarTransacoesC6Api,
  makePixTxid,
  normalizeC6Amount,
  obterPdfBoletoC6Api,
  onlyDigits,
  revisarPixCobC6Api,
};
