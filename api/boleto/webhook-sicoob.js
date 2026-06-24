const { getAdmin } = require('../../nfe/_lib/supabaseAdmin');
const { baixarPorWebhookPayload } = require('./_lib/baixarBoletoPago');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const admin = getAdmin();
    const payload = req.body ?? {};
    const webhookToken = req.headers['x-sicoob-webhook-token'] ?? req.headers['x-webhook-token'] ?? '';

    if (webhookToken) {
      const { data: configs } = await admin
        .from('config_sicoob')
        .select('user_id')
        .eq('webhook_token', webhookToken)
        .eq('ativo', true)
        .limit(1);
      if (!configs?.length) {
        return res.status(401).json({ success: false, message: 'Webhook token inválido.' });
      }
    }

    const result = await baixarPorWebhookPayload(admin, { ...payload, _webhookToken: webhookToken });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message ?? 'Erro interno.' });
  }
};
