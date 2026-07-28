const { getAdmin, getUserFromBearer } = require('../nfe/_lib/supabaseAdmin');
const { emitirUmBoleto } = require('./_lib/emitirBoleto');
const { emitirUmBoletoC6 } = require('./_lib/emitirBoletoC6');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const user = await getUserFromBearer(req);
    const admin = getAdmin();
    const { boletoIds, emitenteId, banco } = req.body ?? {};
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
