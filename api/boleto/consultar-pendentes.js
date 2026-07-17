const { getAdmin } = require('../nfe/_lib/supabaseAdmin');
const { sincronizarBoletosPendentesGlobal } = require('./_lib/baixarBoletoPago');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!cronSecret || token !== cronSecret) {
    return res.status(401).json({ success: false, message: 'Não autorizado.' });
  }

  try {
    const admin = getAdmin();
    const result = await sincronizarBoletosPendentesGlobal(admin, 25);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message ?? 'Erro interno.' });
  }
};
