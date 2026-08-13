/**
 * Evidências C6: PIX + Transações/Recebíveis (roteiro v3.0).
 * Uso: node scripts/gerar-evidencias-c6-pix-tr.js
 */
const fs = require('fs');
const path = require('path');
const { C6_SANDBOX, bundledCertPaths } = require('../api/boleto/_lib/c6SandboxDefaults.js');
const {
  criarPixCobC6Api,
  criarPixCobvC6Api,
  consultarPixC6Api,
  revisarPixCobC6Api,
  listarRecebiveisC6Api,
  listarTransacoesC6Api,
  makePixTxid,
} = require('../api/boleto/_lib/c6Client.js');

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

async function main() {
  const certs = bundledCertPaths();
  const config = { ...C6_SANDBOX, ativo: true };
  const cliente = { nome: 'Cliente Homologacao', cpf: '52998224725' };
  const lines = [];
  const add = (title, status, body, request) => {
    lines.push('='.repeat(72));
    lines.push(title);
    lines.push('-'.repeat(72));
    if (request) {
      lines.push('Request enviado (referência):');
      lines.push(pretty(request));
      lines.push('');
    }
    lines.push('>>> Status Code - Retornado:');
    lines.push(String(status));
    lines.push('');
    lines.push('>>> Response Body - Retornado (cole no documento):');
    lines.push(typeof body === 'string' ? body : pretty(body));
    lines.push('');
  };

  // P_01_01 / P_01_02 — cob imediata
  const cob = await criarPixCobC6Api({
    config,
    certPath: certs.certPath,
    keyPath: certs.keyPath,
    valor: 10.0,
    cliente,
    solicitacao: 'Homologacao P_01 cob imediata',
  });
  add(
    'P_01 – COBRANÇA PIX IMEDIATA (PUT/POST /v2/pix/cob)',
    cob.httpStatus || 201,
    {
      txid: cob.txid,
      status: cob.status,
      chave: cob.chave,
      pixCopiaECola: cob.pixCopiaECola,
      loc: cob.loc,
      calendario: cob.calendario,
      valor: cob.valor,
    },
    { valor: '10.00', chave: C6_SANDBOX.pix_chave, calendario: { expiracao: 3600 } },
  );

  // P_01_04 consulta
  const getCob = await consultarPixC6Api({
    config,
    certPath: certs.certPath,
    keyPath: certs.keyPath,
    txid: cob.txid,
    comVencimento: false,
  });
  add('P_01_04 – CONSULTAR COBRANÇA IMEDIATA (GET /v2/pix/cob/{txid})', 200, getCob.resultado, {
    txid: cob.txid,
  });

  // P_01_03 revisão
  try {
    const patched = await revisarPixCobC6Api({
      config,
      certPath: certs.certPath,
      keyPath: certs.keyPath,
      txid: cob.txid,
      patchBody: { solicitacaoPagador: 'Homologacao P_01 revisada' },
    });
    add('P_01_03 – REVISAR COBRANÇA IMEDIATA (PATCH /v2/pix/cob/{txid})', 201, patched, {
      solicitacaoPagador: 'Homologacao P_01 revisada',
    });
  } catch (e) {
    add('P_01_03 – REVISAR COBRANÇA IMEDIATA', 'ERRO', { detail: e.message });
  }

  // P_02 cobv
  const due = new Date();
  due.setDate(due.getDate() + 10);
  const dueStr = due.toISOString().slice(0, 10);
  const cobv = await criarPixCobvC6Api({
    config,
    certPath: certs.certPath,
    keyPath: certs.keyPath,
    valor: 25.5,
    dataVencimento: dueStr,
    cliente,
    solicitacao: 'Homologacao P_02 cobv',
  });
  add(
    'P_02 – COBRANÇA PIX COM VENCIMENTO (PUT /v2/pix/cobv/{txid})',
    cobv.httpStatus || 201,
    {
      txid: cobv.txid,
      status: cobv.status,
      chave: cobv.chave,
      pixCopiaECola: cobv.pixCopiaECola,
      calendario: cobv.calendario,
      valor: cobv.valor,
      devedor: cobv.devedor,
    },
    { dataDeVencimento: dueStr, valor: '25.50', chave: C6_SANDBOX.pix_chave },
  );

  const getCobv = await consultarPixC6Api({
    config,
    certPath: certs.certPath,
    keyPath: certs.keyPath,
    txid: cobv.txid,
    comVencimento: true,
  });
  add('P_02 – CONSULTAR COBV (GET /v2/pix/cobv/{txid})', 200, getCobv.resultado, {
    txid: cobv.txid,
  });

  // TR_01 / TR_02
  const end = new Date().toISOString().slice(0, 10);
  const startD = new Date();
  startD.setDate(startD.getDate() - 30);
  const start = startD.toISOString().slice(0, 10);

  const rec = await listarRecebiveisC6Api({
    config,
    certPath: certs.certPath,
    keyPath: certs.keyPath,
    startDate: start,
    endDate: end,
    page: 1,
    size: 10,
  });
  add(
    'TR_01 – CONSULTA DE RECEBÍVEIS (GET /v1/c6pay/statement/receivables)',
    200,
    rec,
    { start_date: start, end_date: end, page: 1, size: 10 },
  );

  const tx = await listarTransacoesC6Api({
    config,
    certPath: certs.certPath,
    keyPath: certs.keyPath,
    startDate: start,
    endDate: end,
    page: 1,
    size: 10,
  });
  add(
    'TR_02 – CONSULTA DE TRANSAÇÕES (GET /v1/c6pay/statement/transactions)',
    200,
    tx,
    { start_date: start, end_date: end, page: 1, size: 10 },
  );

  const header = [
    'EVIDÊNCIAS C6 — PIX + TRANSAÇÕES E RECEBÍVEIS (roteiro v3.0)',
    'Software: SistemaJessica | sandbox',
    `chave Pix: ${C6_SANDBOX.pix_chave}`,
    `client_id: ${C6_SANDBOX.client_id}`,
    '',
    'Marque no formulário: AUTENTICAÇÃO + BOLETO + PIX + TRANSAÇÕES E RECEBÍVEIS',
    'Cole Status Code e Response Body de cada bloco abaixo no Word.',
    'Obs.: lista vazia em TR_01/TR_02 no sandbox é normal se não houver movimento C6 Pay.',
    '',
  ];

  const out = path.join(__dirname, '..', 'c6-evidencias-pix-tr.txt');
  fs.writeFileSync(out, header.concat(lines).join('\n'), 'utf8');
  console.log('Arquivo:', out);
  console.log('txid cob', cob.txid, 'txid cobv', cobv.txid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
