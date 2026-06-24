const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { decrypt } = require('../../nfe/_lib/crypto');

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function authUrl(ambiente) {
  if (ambiente === 'sandbox') {
    return 'https://sandbox.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token';
  }
  return 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token';
}

function apiBaseUrl(ambiente) {
  if (ambiente === 'sandbox') {
    return 'https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3';
  }
  return 'https://api.sicoob.com.br/cobranca-bancaria/v3';
}

async function downloadCertToTemp(admin, storagePath) {
  const { data, error } = await admin.storage.from('empresa_certificados').download(storagePath);
  if (error || !data) throw new Error('Não foi possível baixar o certificado A1.');
  const tmp = path.join(os.tmpdir(), `cert-sicoob-${Date.now()}.pfx`);
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function cleanupCert(certPath) {
  try {
    if (certPath) fs.unlinkSync(certPath);
  } catch {
    /* ignore */
  }
}

function httpsRequest(url, { method = 'GET', headers = {}, body, agent }) {
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
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
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

function createMtlsAgent(certPath, passphrase) {
  return new https.Agent({
    pfx: fs.readFileSync(certPath),
    passphrase,
    rejectUnauthorized: true,
  });
}

async function getSicoobAccessToken({ config, certPath, senha }) {
  const agent = createMtlsAgent(certPath, senha);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.client_id,
    scope:
      'cobranca_boletos_consultar cobranca_boletos_incluir cobranca_boletos_alterar cobranca_boletos_pagador',
  }).toString();

  const res = await httpsRequest(authUrl(config.ambiente), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    agent,
  });

  if (res.status < 200 || res.status >= 300 || !res.json?.access_token) {
    const msg =
      res.json?.error_description ??
      res.json?.message ??
      res.json?.raw ??
      `Falha ao obter token Sicoob (${res.status}).`;
    throw new Error(msg);
  }

  return res.json.access_token;
}

function splitInstrucoes(instrucoes) {
  return String(instrucoes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function buildPagadorFromCliente(cliente) {
  const doc = onlyDigits(cliente.cnpj ?? cliente.cpf ?? cliente.documento ?? '');
  const nome = (cliente.nome_fantasia ?? cliente.nome ?? cliente.razao_social ?? 'Pagador').trim();
  const logradouro = [cliente.logradouro, cliente.numero, cliente.complemento].filter(Boolean).join(', ');
  return {
    numeroCpfCnpj: doc,
    nome,
    endereco: logradouro || 'Não informado',
    bairro: (cliente.bairro ?? 'Centro').trim() || 'Centro',
    cidade: (cliente.cidade ?? 'Não informado').trim() || 'Não informado',
    cep: onlyDigits(cliente.cep ?? '00000000').padStart(8, '0').slice(0, 8),
    uf: String(cliente.uf ?? cliente.estado ?? 'SP')
      .trim()
      .toUpperCase()
      .slice(0, 2),
    email: (cliente.email ?? cliente.email_contato ?? cliente.celular ?? '').trim() || undefined,
  };
}

function buildSicoobPayload({ boleto, config, cliente, notaFiscal }) {
  const pagador = buildPagadorFromCliente(cliente);
  if (!pagador.numeroCpfCnpj) {
    throw new Error('Cliente sem CPF/CNPJ válido para emissão de boleto Sicoob.');
  }

  const instrucoes = splitInstrucoes(boleto.instrucoes);
  if (notaFiscal?.numero) {
    instrucoes.unshift(`NFS-e nº ${notaFiscal.numero}${notaFiscal.codigo_verificacao ? ` — verificação ${notaFiscal.codigo_verificacao}` : ''}`);
  }

  const nossoNumero = Number(onlyDigits(boleto.nosso_numero).slice(-8) || '0');
  const seuNumero = (boleto.numero_documento ?? boleto.id.replace(/-/g, '')).slice(0, 15);

  return {
    numeroCliente: Number(config.numero_cliente),
    codigoModalidade: Number(config.codigo_modalidade ?? 1),
    numeroContaCorrente: Number(config.numero_conta_corrente ?? 0),
    codigoEspecieDocumento: config.codigo_especie_documento || 'DM',
    dataEmissao: boleto.data_documento,
    nossoNumero: nossoNumero > 0 ? nossoNumero : undefined,
    seuNumero,
    identificacaoBoletoEmpresa: seuNumero,
    identificacaoEmissaoBoleto: Number(config.identificacao_emissao_boleto ?? 1),
    identificacaoDistribuicaoBoleto: Number(config.identificacao_distribuicao_boleto ?? 1),
    valor: Number(boleto.valor_documento),
    dataVencimento: boleto.data_vencimento,
    dataLimitePagamento: boleto.data_vencimento,
    tipoDesconto: 0,
    tipoMulta: 0,
    tipoJurosMora: 0,
    numeroParcela: 1,
    aceite: true,
    codigoNegativacao: 2,
    codigoProtesto: 3,
    pagador,
    mensagensInstrucao: instrucoes.length ? instrucoes : ['Pagamento referente a serviços prestados.'],
    gerarPdf: true,
    numeroDiasNegativacao: 0,
    numeroDiasProtesto: 0,
  };
}

function extractBoletoResponse(json) {
  const result = json?.resultado ?? json;
  return {
    linha_digitavel: result?.linhaDigitavel ?? result?.numeroLinhaDigitavel ?? null,
    codigo_barras: result?.codigoBarras ?? null,
    nosso_numero_banco: result?.nossoNumero != null ? String(result.nossoNumero) : null,
    pdf_base64: result?.pdfBoleto ?? result?.pdf ?? null,
    seu_numero: result?.seuNumero ?? null,
    raw: result,
  };
}

async function emitirBoletoSicoobApi({ config, certPath, senha, payload, ambiente }) {
  const token = await getSicoobAccessToken({ config, certPath, senha });
  const agent = createMtlsAgent(certPath, senha);
  const body = JSON.stringify(payload);

  const res = await httpsRequest(`${apiBaseUrl(ambiente)}/boletos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    agent,
  });

  if (res.status < 200 || res.status >= 300) {
    const msg =
      res.json?.mensagens?.map((m) => m.mensagem).join(' · ') ??
      res.json?.message ??
      res.json?.error_description ??
      res.raw ??
      `Sicoob rejeitou a emissão (${res.status}).`;
    throw new Error(msg);
  }

  return extractBoletoResponse(res.json);
}

function isBoletoLiquidado(resultado) {
  const situacao = String(resultado?.situacaoBoleto ?? resultado?.situacao ?? '').toLowerCase();
  return situacao.includes('liquid') || situacao.includes('pago') || situacao === 'baixado';
}

function extractDataPagamento(resultado) {
  const hist = Array.isArray(resultado?.listaHistorico) ? resultado.listaHistorico : [];
  const liq = hist.find((h) =>
    String(h?.descricaoHistorico ?? h?.tipoHistorico ?? '')
      .toLowerCase()
      .includes('liquid'),
  );
  const raw =
    resultado?.dataPagamento ??
    resultado?.dataLiquidacao ??
    liq?.dataHistorico ??
    new Date().toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

function extractValorPago(resultado, fallback) {
  const v = Number(resultado?.valorPago ?? resultado?.valor ?? fallback);
  return Number.isFinite(v) && v > 0 ? v : Number(fallback);
}

async function consultarBoletoSicoobApi({ config, certPath, senha, boleto }) {
  const token = await getSicoobAccessToken({ config, certPath, senha });
  const agent = createMtlsAgent(certPath, senha);
  const params = new URLSearchParams({
    numeroCliente: String(config.numero_cliente),
    codigoModalidade: String(config.codigo_modalidade ?? 1),
  });

  if (boleto.nosso_numero_banco) {
    params.set('nossoNumero', String(boleto.nosso_numero_banco));
  } else if (boleto.linha_digitavel) {
    params.set('linhaDigitavel', String(boleto.linha_digitavel));
  } else if (boleto.codigo_barras) {
    params.set('codigoBarras', String(boleto.codigo_barras));
  } else {
    throw new Error('Boleto sem identificador para consulta no Sicoob.');
  }

  const res = await httpsRequest(`${apiBaseUrl(config.ambiente)}/boletos?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    agent,
  });

  if (res.status === 204) {
    return { liquidado: false, resultado: null };
  }
  if (res.status < 200 || res.status >= 300) {
    const msg =
      res.json?.mensagens?.map((m) => m.mensagem).join(' · ') ??
      res.json?.message ??
      res.raw ??
      `Consulta Sicoob falhou (${res.status}).`;
    throw new Error(msg);
  }

  const resultado = res.json?.resultado ?? res.json;
  const row = Array.isArray(resultado) ? resultado[0] : resultado;
  return {
    liquidado: isBoletoLiquidado(row),
    resultado: row,
    dataPagamento: extractDataPagamento(row),
    valorPago: extractValorPago(row, boleto.valor_documento),
  };
}

module.exports = {
  apiBaseUrl,
  authUrl,
  buildPagadorFromCliente,
  buildSicoobPayload,
  cleanupCert,
  consultarBoletoSicoobApi,
  downloadCertToTemp,
  emitirBoletoSicoobApi,
  extractDataPagamento,
  extractValorPago,
  isBoletoLiquidado,
  onlyDigits,
};
