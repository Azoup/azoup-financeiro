const { getAdmin, getUserFromBearer } = require('../nfe/_lib/supabaseAdmin');
const { sincronizarBoletosPendentesUsuario } = require('./_lib/baixarBoletoPago');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const user = await getUserFromBearer(req);
    const admin = getAdmin();
    const result = await sincronizarBoletosPendentesUsuario(admin, user.id, 40);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message ?? 'Erro interno.' });
  }
};
