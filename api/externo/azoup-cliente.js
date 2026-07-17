const { getUserFromBearer } = require('../nfe/_lib/supabaseAdmin');
const { getAzoupAdminClient } = require('./_lib/azoupAdminClient');
const { carregarClienteAzoupParaNf } = require('./_lib/dashboardData');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    await getUserFromBearer(req);
    const admin = getAzoupAdminClient();

    const id =
      (typeof req.query?.id === 'string' ? req.query.id : null) ||
      (typeof req.body?.id === 'string' ? req.body.id : null) ||
      (typeof req.body?.cliente_id === 'string' ? req.body.cliente_id : null);

    const data = await carregarClienteAzoupParaNf(admin, id);
    return res.status(200).json({ success: true, cliente: data });
  } catch (error) {
    const message = error.message ?? 'Erro interno.';
    const status =
      message.includes('Não autorizado') || message.includes('Token')
        ? 401
        : message.includes('não configurado')
          ? 503
          : message.includes('obrigatório') || message.includes('não encontrado')
            ? 400
            : 500;
    return res.status(status).json({ success: false, message });
  }
};
