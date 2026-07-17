const { getUserFromBearer } = require('../nfe/_lib/supabaseAdmin');
const { getAzoupAdminClient } = require('./_lib/azoupAdminClient');
const { carregarDashboardAzoup } = require('./_lib/dashboardData');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    await getUserFromBearer(req);
    const admin = getAzoupAdminClient();
    const data = await carregarDashboardAzoup(admin);
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    const message = error.message ?? 'Erro interno.';
    const status =
      message.includes('Não autorizado') || message.includes('Token')
        ? 401
        : message.includes('não configurado')
          ? 503
          : 500;
    return res.status(status).json({ success: false, message });
  }
};
