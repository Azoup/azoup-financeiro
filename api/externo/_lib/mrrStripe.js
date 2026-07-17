/**
 * Calcula MRR líquido/bruto via Stripe (cupons), espelhando admin-stripe compute_mrr.
 * Requer AZOUP_STRIPE_SECRET_KEY no servidor.
 */

const { classificarStatusAssinatura } = require('./assinaturaStatus');

function onlyDigits(s) {
  return `${s ?? ''}`.replace(/\D/g, '');
}

async function stripeGet(path, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Stripe HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = body?.error?.code;
    throw err;
  }
  return body;
}

function aplicarDescontoItens(subscription) {
  let bruto = 0;
  for (const item of subscription.items?.data ?? []) {
    const unit = item.price?.unit_amount ?? 0;
    const qty = item.quantity ?? 1;
    if (item.price?.recurring?.interval === 'year') {
      bruto += Math.round((unit * qty) / 12);
    } else {
      bruto += unit * qty;
    }
  }
  bruto = Math.max(0, Math.round(bruto));
  const discount = subscription.discount;
  const coupon = discount?.coupon;
  if (!coupon || bruto <= 0) {
    return { liquido_centavos: bruto, bruto_centavos: bruto, desconto_centavos: 0 };
  }
  let desconto = 0;
  if (coupon.percent_off != null) {
    desconto = Math.round((bruto * Number(coupon.percent_off)) / 100);
  } else if (coupon.amount_off != null) {
    desconto = Math.min(bruto, Math.round(Number(coupon.amount_off)));
  }
  return {
    bruto_centavos: bruto,
    desconto_centavos: desconto,
    liquido_centavos: Math.max(0, bruto - desconto),
  };
}

async function mrrDeAssinaturaStripe(secretKey, subscriptionId) {
  try {
    const upcoming = await stripeGet(
      `/invoices/upcoming?subscription=${encodeURIComponent(subscriptionId)}`,
      secretKey,
    );
    const liquido = Math.max(0, Math.round(Number(upcoming.total ?? 0)));
    const descontoLista = upcoming.total_discount_amounts ?? [];
    const desconto = Math.max(
      0,
      descontoLista.reduce((acc, d) => acc + Math.round(Number(d.amount ?? 0)), 0),
    );
    const bruto = Math.max(
      liquido + desconto,
      Math.round(Number(upcoming.subtotal ?? liquido + desconto)),
    );
    return {
      liquido_centavos: liquido,
      bruto_centavos: bruto,
      desconto_centavos: Math.min(desconto, bruto),
    };
  } catch {
    const subscription = await stripeGet(
      `/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=discount&expand[]=items.data.price`,
      secretKey,
    );
    return aplicarDescontoItens(subscription);
  }
}

async function mapInBatches(items, batchSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const partial = await Promise.all(chunk.map(fn));
    out.push(...partial);
  }
  return out;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Map<string, object>} porClienteAssinatura — melhor assinatura por cliente
 * @returns {Promise<null | {
 *   mrr_centavos: number,
 *   mrr_bruto_centavos: number,
 *   desconto_centavos: number,
 *   assinaturas_com_desconto: number,
 *   porCliente: Map<string, { liquido_centavos: number, bruto_centavos: number, desconto_centavos: number }>
 * }>}
 */
async function computeMrrStripe(admin, porClienteAssinatura) {
  const secretKey = (
    process.env.AZOUP_STRIPE_SECRET_KEY ??
    process.env.STRIPE_SECRET_KEY_AZOUP ??
    ''
  ).trim();
  if (!secretKey) return null;

  const ativas = [];
  for (const [clienteId, a] of porClienteAssinatura.entries()) {
    if (classificarStatusAssinatura(a) !== 'ativa') continue;
    const sid = `${a.stripe_subscription_id ?? ''}`.trim();
    if (!sid) continue;
    ativas.push({ clienteId, assinatura: a, stripeId: sid });
  }

  if (!ativas.length) {
    return {
      mrr_centavos: 0,
      mrr_bruto_centavos: 0,
      desconto_centavos: 0,
      assinaturas_com_desconto: 0,
      porCliente: new Map(),
    };
  }

  const resultados = await mapInBatches(ativas, 8, async (item) => {
    try {
      const valores = await mrrDeAssinaturaStripe(secretKey, item.stripeId);
      return { clienteId: item.clienteId, ok: true, ...valores };
    } catch (e) {
      const a = item.assinatura;
      let fallback = 0;
      if (a.valor_atual_centavos != null) fallback = Number(a.valor_atual_centavos) || 0;
      else if (a.valor_mensal_atual != null) fallback = Math.round(Number(a.valor_mensal_atual) * 100) || 0;
      return {
        clienteId: item.clienteId,
        ok: false,
        liquido_centavos: fallback,
        bruto_centavos: fallback,
        desconto_centavos: 0,
        erro: e instanceof Error ? e.message : 'Falha Stripe',
      };
    }
  });

  let mrr_centavos = 0;
  let mrr_bruto_centavos = 0;
  let desconto_centavos = 0;
  let assinaturas_com_desconto = 0;
  const porCliente = new Map();

  for (const r of resultados) {
    mrr_centavos += r.liquido_centavos;
    mrr_bruto_centavos += r.bruto_centavos;
    desconto_centavos += r.desconto_centavos;
    if (r.desconto_centavos > 0) assinaturas_com_desconto += 1;
    porCliente.set(r.clienteId, {
      liquido_centavos: r.liquido_centavos,
      bruto_centavos: r.bruto_centavos,
      desconto_centavos: r.desconto_centavos,
    });
  }

  return {
    mrr_centavos,
    mrr_bruto_centavos,
    desconto_centavos,
    assinaturas_com_desconto,
    porCliente,
  };
}

module.exports = { computeMrrStripe, onlyDigits };
