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

function buildC6Payload({ boleto, config, cliente }) {
  const taxId = onlyDigits(cliente.cnpj ?? cliente.cpf ?? cliente.documento ?? '');
  if (!taxId) throw new Error('Cliente sem CPF/CNPJ válido para emissão de boleto C6.');

  const name = (cliente.nome_fantasia ?? cliente.nome ?? cliente.razao_social ?? 'Pagador').trim();
  const street = (cliente.logradouro ?? 'Não informado').trim() || 'Não informado';
  const number = String(cliente.numero ?? 'S/N').trim() || 'S/N';
  const city = (cliente.cidade ?? 'Não informado').trim() || 'Não informado';
  const state = String(cliente.uf ?? cliente.estado ?? 'SP')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const zip = onlyDigits(cliente.cep ?? '00000000').padStart(8, '0').slice(0, 8);

  const ourNumber = onlyDigits(boleto.nosso_numero || boleto.id).slice(-10) || '1';
  const externalId = String(boleto.numero_documento || boleto.id.replace(/-/g, ''))
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 26);

  const billing =
    String(config.billing_scheme || '').trim() ||
    (config.ambiente === 'producao' ? '15' : '21');

  const instructions = splitInstrucoes(boleto.instrucoes);
  if (!instructions.length) instructions.push('Pagamento referente a serviços prestados.');

  return {
    external_reference_id: externalId,
    amount: Number(boleto.valor_documento),
    due_date: String(boleto.data_vencimento).slice(0, 10),
    instructions,
    billing_scheme: String(billing),
    our_number: String(ourNumber),
    payer: {
      name,
      tax_id: taxId,
      email: (cliente.email ?? cliente.email_contato ?? '').trim() || undefined,
      address: {
        street,
        number,
        complement: (cliente.complemento ?? '').trim() || undefined,
        city,
        state,
        zip_code: zip,
      },
    },
  };
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
    const msg =
      res.json?.message ??
      res.json?.error_description ??
      res.json?.error ??
      (Array.isArray(res.json?.errors) ? JSON.stringify(res.json.errors) : null) ??
      res.raw ??
      `C6 rejeitou a emissão (${res.status}).`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
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

module.exports = {
  apiBaseUrl,
  buildC6Payload,
  cleanupTemp,
  consultarBoletoC6Api,
  createMtlsAgent,
  downloadC6FileToTemp,
  emitirBoletoC6Api,
  extractC6DataPagamento,
  extractC6ValorPago,
  getC6AccessToken,
  isC6BoletoLiquidado,
  obterPdfBoletoC6Api,
  onlyDigits,
};
