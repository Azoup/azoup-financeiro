/**
 * Lista faturas Stripe (Azoup Web) por período, enriquecidas com CNPJ da empresa matriz.
 */
const { onlyDigits } = require('./mrrStripe');
const { pickEnderecoEmpresa, rotuloEmpresaMatriz, nomeCliente } = require('./dashboardData');

function stripeSecret() {
  return (
    process.env.AZOUP_STRIPE_SECRET_KEY ??
    process.env.STRIPE_SECRET_KEY_AZOUP ??
    process.env.STRIPE_SECRET_KEY ??
    ''
  ).trim();
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
    throw new Error(body?.error?.message || `Stripe HTTP ${res.status}`);
  }
  return body;
}

function parseYmd(s) {
  const m = `${s ?? ''}`.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function startOfDayUnix(ymd) {
  const p = parseYmd(ymd);
  if (!p) return null;
  return Math.floor(Date.UTC(p.y, p.mo - 1, p.d, 0, 0, 0) / 1000);
}

function endOfDayUnix(ymd) {
  const p = parseYmd(ymd);
  if (!p) return null;
  return Math.floor(Date.UTC(p.y, p.mo - 1, p.d, 23, 59, 59) / 1000);
}

function competenciaDeTs(ts) {
  if (ts == null || !Number.isFinite(Number(ts))) return null;
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}`;
}

function competenciaDeIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}`;
}

function statusPago(status) {
  const s = `${status ?? ''}`.trim().toLowerCase();
  return s === 'paid' || s === 'pago' || s === 'paga';
}

function normalizeStatusFiltro(raw) {
  const s = `${raw ?? 'todos'}`.trim().toLowerCase();
  if (!s || s === 'todas' || s === 'all') return 'todos';
  if (s === 'paid' || s === 'paga' || s === 'pagas') return 'pago';
  if (s === 'provisoria' || s === 'provisórias' || s === 'provisorias') return 'draft';
  if (s === 'abertas' || s === 'aberta') return 'open';
  if (s === 'vencidas' || s === 'vencida') return 'overdue';
  return s;
}

/** Stripe só filtra por `created`; a tela usa pagamento. Inclui se qualquer data cair no período. */
function invoiceTouchesPeriod(inv, fromUnix, toUnix) {
  if (fromUnix == null && toUnix == null) return true;
  const candidates = [
    inv.status_transitions?.paid_at,
    inv.created,
    inv.period_start,
    inv.period_end,
    inv.due_date,
  ]
    .map((t) => (t == null ? null : Number(t)))
    .filter((t) => t != null && Number.isFinite(t));
  if (!candidates.length) return true;
  return candidates.some((t) => {
    if (fromUnix != null && t < fromUnix) return false;
    if (toUnix != null && t > toUnix) return false;
    return true;
  });
}

function startOfDayUnixMinusDays(ymd, days) {
  const base = startOfDayUnix(ymd);
  if (base == null) return null;
  return base - Math.max(0, days) * 24 * 60 * 60;
}

function statusLinhaMatches(statusLinha, dueUnix, filtro) {
  const st = `${statusLinha ?? ''}`.trim().toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);
  const overdue =
    (st === 'open' || st === 'aberta' || st === 'overdue' || st === 'vencida') &&
    ((st === 'overdue' || st === 'vencida') ||
      (dueUnix != null && Number.isFinite(Number(dueUnix)) && Number(dueUnix) < nowSec));

  if (filtro === 'todos') return true;
  if (filtro === 'pago') return statusPago(st);
  if (filtro === 'draft') return st === 'draft' || st === 'provisoria' || st === 'provisória';
  if (filtro === 'overdue') return overdue;
  if (filtro === 'open') {
    return (st === 'open' || st === 'aberta') && !overdue;
  }
  return st === filtro;
}

function statusExibicao(status, dueUnix) {
  const st = `${status ?? ''}`.trim().toLowerCase();
  if (statusPago(st)) return 'pago';
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    st === 'open' &&
    dueUnix != null &&
    Number.isFinite(Number(dueUnix)) &&
    Number(dueUnix) < nowSec
  ) {
    return 'overdue';
  }
  return st;
}

function valorCentavosHistorico(row) {
  if (row.valor_centavos != null && row.valor_centavos !== '') {
    return Math.max(0, Math.round(Number(row.valor_centavos)) || 0);
  }
  if (row.valor_total != null && row.valor_total !== '') {
    return Math.max(0, Math.round(Number(row.valor_total) * 100) || 0);
  }
  return 0;
}

async function carregarMapasClientes(admin) {
  const [clientesRes, assinaturasRes, empresasRes] = await Promise.all([
    admin.from('clientes_azoup').select('id,nome,email,telefone,stripe_customer_id').limit(5000),
    admin
      .from('assinaturas_clientes')
      .select('cliente_id,stripe_customer_id,stripe_subscription_id')
      .limit(8000),
    admin.from('empresas').select('*').eq('empresa_matriz', true).limit(5000),
  ]);

  if (clientesRes.error) throw new Error(clientesRes.error.message);
  if (assinaturasRes.error) throw new Error(assinaturasRes.error.message);

  const clientes = clientesRes.data ?? [];
  const assinaturas = assinaturasRes.data ?? [];
  const empresas = empresasRes.error ? [] : empresasRes.data ?? [];

  const clienteById = new Map(clientes.map((c) => [c.id, c]));
  const byCustomer = new Map();
  const byEmail = new Map();
  const bySubscription = new Map();

  for (const c of clientes) {
    const cus = `${c.stripe_customer_id ?? ''}`.trim();
    if (cus) byCustomer.set(cus, c.id);
    const email = `${c.email ?? ''}`.trim().toLowerCase();
    if (email) byEmail.set(email, c.id);
  }
  for (const a of assinaturas) {
    const cus = `${a.stripe_customer_id ?? ''}`.trim();
    if (cus && a.cliente_id) byCustomer.set(cus, a.cliente_id);
    const sub = `${a.stripe_subscription_id ?? ''}`.trim();
    if (sub && a.cliente_id) bySubscription.set(sub, a.cliente_id);
  }

  const empresaPorCliente = new Map();
  for (const e of empresas) {
    if (!e?.cliente_id) continue;
    if (!empresaPorCliente.has(e.cliente_id)) empresaPorCliente.set(e.cliente_id, e);
  }

  return { clienteById, byCustomer, byEmail, bySubscription, empresaPorCliente };
}

function montarLinha({
  id,
  stripeInvoiceId,
  numero,
  clienteId,
  clienteById,
  empresaPorCliente,
  emailFallback,
  nomeFallback,
  valorCentavos,
  status,
  periodoInicio,
  periodoFim,
  dataPagamento,
  criadoEm,
  competencia,
  frequencia,
  fonte,
  vencimento,
}) {
  const cliente = clienteId ? clienteById.get(clienteId) : null;
  const empresa = clienteId ? empresaPorCliente.get(clienteId) : null;
  const cnpj = onlyDigits(empresa?.cnpj);
  const endereco = pickEnderecoEmpresa(empresa);
  const nome =
    (cliente ? nomeCliente(cliente) : null) ||
    rotuloEmpresaMatriz(empresa) ||
    nomeFallback ||
    emailFallback ||
    'Cliente Stripe';
  const statusNorm = statusExibicao(status, (() => {
    if (!vencimento) return null;
    const ms = Date.parse(vencimento);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  })());

  return {
    id,
    stripe_invoice_id: stripeInvoiceId,
    numero: numero || null,
    azoup_cliente_id: clienteId || null,
    cliente_nome: nome,
    cliente_email: cliente?.email ?? emailFallback ?? null,
    empresa_matriz_nome: rotuloEmpresaMatriz(empresa),
    empresa_matriz_cnpj: cnpj.length === 14 ? cnpj : cnpj || null,
    pode_emitir_nf:
      Boolean(clienteId) && cnpj.length === 14 && valorCentavos > 0 && statusPago(statusNorm),
    valor_centavos: valorCentavos,
    status: statusNorm,
    periodo_inicio: periodoInicio,
    periodo_fim: periodoFim,
    data_pagamento: dataPagamento,
    criado_em: criadoEm,
    vencimento: vencimento || null,
    competencia,
    frequencia: frequencia || 'Mensal',
    endereco,
    fonte,
    nfse_emitida: false,
    nota_fiscal_id: null,
  };
}

async function listarFaturasStripe(secretKey, { fromUnix, toUnix, status }) {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (status) params.set('status', status);
    if (fromUnix != null) params.set('created[gte]', String(fromUnix));
    if (toUnix != null) params.set('created[lte]', String(toUnix));
    if (startingAfter) params.set('starting_after', startingAfter);
    const body = await stripeGet(`/invoices?${params.toString()}`, secretKey);
    const rows = body.data ?? [];
    out.push(...rows);
    if (!body.has_more || !rows.length) break;
    startingAfter = rows[rows.length - 1].id;
  }
  return out;
}

async function listarFaturasHistorico(admin, { fromIso, toIso }) {
  let q = admin.from('historico_faturas').select('*').limit(3000);
  // Preferência: periodo_inicio; fallback criado_em/created_at no filtro em memória
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const fromMs = fromIso ? Date.parse(`${fromIso}T00:00:00.000Z`) : null;
  const toMs = toIso ? Date.parse(`${toIso}T23:59:59.999Z`) : null;

  return (data ?? []).filter((row) => {
    const ref =
      row.periodo_inicio ||
      row.data_pagamento ||
      row.criado_em ||
      row.created_at ||
      null;
    if (!ref) return true;
    const ms = Date.parse(ref);
    if (Number.isNaN(ms)) return true;
    if (fromMs != null && ms < fromMs) return false;
    if (toMs != null && ms > toMs) return false;
    return true;
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ from?: string; to?: string; status?: string }} opts from/to = YYYY-MM-DD
 */
async function listarFaturasAzoup(admin, opts = {}) {
  const from = `${opts.from ?? ''}`.trim() || null;
  const to = `${opts.to ?? ''}`.trim() || null;
  const statusFiltro = normalizeStatusFiltro(opts.status);

  const maps = await carregarMapasClientes(admin);
  const byInvoice = new Map();

  const secret = stripeSecret();
  if (!secret) {
    throw new Error(
      'AZOUP_STRIPE_SECRET_KEY não configurada na Vercel. Sem ela a lista de faturas fica vazia.',
    );
  }

  try {
    const fromUnix = from ? startOfDayUnix(from) : null;
    const toUnix = to ? endOfDayUnix(to) : null;
    // Busca created mais cedo: fatura pode ter sido criada no mês anterior e paga neste mês.
    const fetchFromUnix = from ? startOfDayUnixMinusDays(from, 120) : null;
    let stripeStatus = null;
    if (statusFiltro === 'pago') stripeStatus = 'paid';
    else if (statusFiltro === 'draft') stripeStatus = 'draft';
    else if (statusFiltro === 'open' || statusFiltro === 'overdue') stripeStatus = 'open';
    else if (statusFiltro === 'todos') stripeStatus = null;
    else stripeStatus = statusFiltro;

    const invoices = await listarFaturasStripe(secret, {
      fromUnix: fetchFromUnix,
      toUnix,
      status: stripeStatus,
    });

    for (const inv of invoices) {
      if (!invoiceTouchesPeriod(inv, fromUnix, toUnix)) continue;
      if (!statusLinhaMatches(inv.status, inv.due_date, statusFiltro)) continue;

      const customerId =
        typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;
      const email = `${inv.customer_email ?? ''}`.trim().toLowerCase() || null;
      const subId =
        typeof inv.subscription === 'string'
          ? inv.subscription
          : inv.subscription?.id ?? null;

      let clienteId =
        (customerId && maps.byCustomer.get(customerId)) ||
        (email && maps.byEmail.get(email)) ||
        (subId && maps.bySubscription.get(subId)) ||
        null;

      const valorCentavos = Math.max(
        0,
        Math.round(Number(inv.amount_paid ?? inv.total ?? inv.amount_due ?? 0)) || 0,
      );
      const periodoInicio = inv.period_start
        ? new Date(inv.period_start * 1000).toISOString()
        : null;
      const periodoFim = inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null;
      const dataPagamento = inv.status_transitions?.paid_at
        ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
        : null;
      const criadoEm = inv.created ? new Date(inv.created * 1000).toISOString() : null;
      const vencimento = inv.due_date
        ? new Date(inv.due_date * 1000).toISOString()
        : null;
      const competencia =
        competenciaDeTs(inv.period_start) || competenciaDeTs(inv.created) || null;

      const linha = montarLinha({
        id: inv.id,
        stripeInvoiceId: inv.id,
        numero: inv.number,
        clienteId,
        clienteById: maps.clienteById,
        empresaPorCliente: maps.empresaPorCliente,
        emailFallback: inv.customer_email ?? null,
        nomeFallback: inv.customer_name ?? null,
        valorCentavos,
        status: inv.status === 'paid' ? 'pago' : inv.status,
        periodoInicio,
        periodoFim,
        dataPagamento,
        criadoEm,
        competencia,
        frequencia: 'Mensal',
        fonte: 'stripe',
        vencimento,
      });
      byInvoice.set(inv.id, linha);
    }
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[azoup-faturas] Stripe list falhou:', msg);
    throw new Error(`Falha ao listar faturas no Stripe: ${msg}`);
  }

  try {
    const hist = await listarFaturasHistorico(admin, { fromIso: from, toIso: to });
    for (const row of hist) {
      const sid = `${row.stripe_invoice_id ?? row.id ?? ''}`.trim();
      if (!sid) continue;
      if (byInvoice.has(sid)) continue;

      const statusHist = statusPago(row.status) ? 'pago' : `${row.status ?? 'pago'}`.toLowerCase();
      const vencimento = row.vencimento || row.due_date || null;
      const dueUnix = vencimento ? Math.floor(Date.parse(vencimento) / 1000) : null;
      if (!statusLinhaMatches(statusHist, dueUnix, statusFiltro)) continue;

      const clienteId = row.cliente_id ?? null;
      const valorCentavos = valorCentavosHistorico(row);
      const periodoInicio = row.periodo_inicio ?? null;
      const periodoFim = row.periodo_fim ?? null;
      const dataPagamento = row.data_pagamento ?? null;
      const criadoEm = row.criado_em ?? row.created_at ?? null;
      const competencia =
        competenciaDeIso(periodoInicio) ||
        competenciaDeIso(dataPagamento) ||
        competenciaDeIso(criadoEm);

      byInvoice.set(
        sid,
        montarLinha({
          id: row.id || sid,
          stripeInvoiceId: sid,
          numero: row.numero ?? null,
          clienteId,
          clienteById: maps.clienteById,
          empresaPorCliente: maps.empresaPorCliente,
          emailFallback: null,
          nomeFallback: null,
          valorCentavos,
          status: statusHist,
          periodoInicio,
          periodoFim,
          dataPagamento,
          criadoEm,
          competencia,
          frequencia: 'Mensal',
          fonte: 'historico',
          vencimento,
        }),
      );
    }
  } catch (e) {
    console.warn('[azoup-faturas] historico_faturas falhou:', e?.message ?? e);
  }

  const faturas = [...byInvoice.values()].sort((a, b) => {
    const da = a.data_pagamento || a.periodo_inicio || a.criado_em || '';
    const db = b.data_pagamento || b.periodo_inicio || b.criado_em || '';
    return `${db}`.localeCompare(`${da}`);
  });

  return {
    gerado_em: new Date().toISOString(),
    from,
    to,
    status: statusFiltro,
    total: faturas.length,
    faturas,
  };
}

module.exports = { listarFaturasAzoup };
