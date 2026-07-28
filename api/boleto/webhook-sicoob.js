const { getAdmin } = require('../nfe/_lib/supabaseAdmin');
const { baixarPorWebhookPayload, baixarPorWebhookPayloadC6 } = require('./_lib/baixarBoletoPago');

function isC6Payload(req, payload) {
  const header =
    req.headers['x-c6-webhook-token'] ??
    req.headers['x-webhook-banco'] ??
    '';
  if (header) return true;
  if (req.query?.banco === 'c6' || req.query?.provider === 'c6') return true;
  // Heurística C6: id estilo ULID / external_reference_id / bank_slip
  if (payload?.external_reference_id || payload?.bank_slip_id || payload?.bankSlipId) return true;
  if (payload?.data?.external_reference_id || payload?.data?.id) return true;
  const event = String(payload?.event ?? payload?.type ?? '').toLowerCase();
  if (event.includes('bank_slip') || event.includes('boleto')) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const admin = getAdmin();
    const payload = req.body ?? {};
    const c6Mode = isC6Payload(req, payload);

    if (c6Mode) {
      const webhookToken =
        req.headers['x-c6-webhook-token'] ??
        req.headers['x-webhook-token'] ??
        req.query?.token ??
        '';

      if (webhookToken) {
        const { data: configs } = await admin
          .from('config_c6')
          .select('user_id')
          .eq('webhook_token', webhookToken)
          .eq('ativo', true)
          .limit(1);
        if (!configs?.length) {
          return res.status(401).json({ success: false, message: 'Webhook token C6 inválido.' });
        }
      }

      const result = await baixarPorWebhookPayloadC6(admin, {
        ...payload,
        _webhookToken: webhookToken,
      });
      return res.status(200).json({ success: true, ...result });
    }

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
