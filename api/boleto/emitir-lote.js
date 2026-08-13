const { getAdmin, getUserFromBearer } = require('../nfe/_lib/supabaseAdmin');
const { emitirUmBoleto } = require('./_lib/emitirBoleto');
const { emitirUmBoletoC6 } = require('./_lib/emitirBoletoC6');
const { loadC6Credentials } = require('./_lib/c6Credentials');
const {
  cleanupTemp,
  criarPixCobC6Api,
  criarPixCobvC6Api,
  consultarPixC6Api,
  listarRecebiveisC6Api,
  listarTransacoesC6Api,
  revisarPixCobC6Api,
} = require('./_lib/c6Client');

/**
 * Multiplex:
 * - padrão: emite boletos (Sicoob/C6)
 * - action=pix-cob | pix-cobv | pix-get | pix-patch | receivables | transactions
 * (evita nova serverless function no limite Hobby)
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const user = await getUserFromBearer(req);
    const admin = getAdmin();
    const body = req.body ?? {};
    const action = String(body.action || '').trim();

    if (action) {
      const emitenteId = body.emitenteId;
      if (!emitenteId) {
        return res.status(400).json({ success: false, message: 'Informe emitenteId.' });
      }
      const creds = await loadC6Credentials(admin, user.id, emitenteId);
      try {
        if (action === 'pix-cob') {
          const data = await criarPixCobC6Api({
            config: creds.config,
            certPath: creds.certPath,
            keyPath: creds.keyPath,
            valor: body.valor,
            chave: body.chave,
            txid: body.txid,
            expiracao: body.expiracao,
            cliente: body.cliente,
            solicitacao: body.solicitacao,
          });
          return res.status(200).json({ success: true, data });
        }
        if (action === 'pix-cobv') {
          const data = await criarPixCobvC6Api({
            config: creds.config,
            certPath: creds.certPath,
            keyPath: creds.keyPath,
            valor: body.valor,
            chave: body.chave,
            dataVencimento: body.dataVencimento,
            cliente: body.cliente,
            solicitacao: body.solicitacao,
            txid: body.txid,
          });
          return res.status(200).json({ success: true, data });
        }
        if (action === 'pix-get') {
          const data = await consultarPixC6Api({
            config: creds.config,
            certPath: creds.certPath,
            keyPath: creds.keyPath,
            txid: body.txid,
            comVencimento: Boolean(body.comVencimento),
          });
          return res.status(200).json({ success: true, data });
        }
        if (action === 'pix-patch') {
          const data = await revisarPixCobC6Api({
            config: creds.config,
            certPath: creds.certPath,
            keyPath: creds.keyPath,
            txid: body.txid,
            patchBody: body.patchBody || {},
          });
          return res.status(200).json({ success: true, data });
        }
        if (action === 'receivables') {
          const data = await listarRecebiveisC6Api({
            config: creds.config,
            certPath: creds.certPath,
            keyPath: creds.keyPath,
            startDate: body.startDate,
            endDate: body.endDate,
            page: body.page,
            size: body.size,
          });
          return res.status(200).json({ success: true, data });
        }
        if (action === 'transactions') {
          const data = await listarTransacoesC6Api({
            config: creds.config,
            certPath: creds.certPath,
            keyPath: creds.keyPath,
            startDate: body.startDate,
            endDate: body.endDate,
            page: body.page,
            size: body.size,
          });
          return res.status(200).json({ success: true, data });
        }
        return res.status(400).json({ success: false, message: `action desconhecida: ${action}` });
      } finally {
        if (!creds.bundled) {
          cleanupTemp(creds.certPath);
          cleanupTemp(creds.keyPath);
        }
      }
    }

    const { boletoIds, emitenteId, banco } = body;
    const ids = Array.isArray(boletoIds) ? boletoIds.filter(Boolean) : [];
    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'Informe boletoIds.' });
    }

    const usarC6 = banco === 'c6' || Boolean(emitenteId);
    if (usarC6 && !emitenteId) {
      return res.status(400).json({ success: false, message: 'Informe emitenteId para emissão C6.' });
    }

    const resultados = [];
    const erros = [];
    let emitidos = 0;

    for (const boletoId of ids) {
      try {
        const result = usarC6
          ? await emitirUmBoletoC6(admin, user.id, boletoId, emitenteId)
          : await emitirUmBoleto(admin, user.id, boletoId);
        resultados.push(result);
        if (result.status_registro === 'registrado') emitidos += 1;
      } catch (error) {
        const msg = `${boletoId}: ${error.message}`;
        erros.push(msg);
        resultados.push({ success: false, boletoId, message: error.message, status_registro: 'erro' });
      }
    }

    return res.status(200).json({
      success: erros.length === 0,
      emitidos,
      erros,
      resultados,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message ?? 'Erro interno.' });
  }
};
