const {
  classificarStatusAssinatura,
  prioridadeAssinatura,
} = require('./assinaturaStatus');

/** Colunas reais de `clientes_azoup` no schema Azoup (sem razao_social/nome_fantasia/celular). */
const CLIENTE_SELECT_COLS = 'id,nome,email,telefone,created_at';

/**
 * Campos usados da tela inicial / listagem (docs + metrics-repo / conversas-repo).
 * Evita SELECT de colunas legadas que não existem no banco.
 */
const ASSINATURA_SELECT_COLS = '*';

function pickAssinaturaPorCliente(assinaturas) {
  const porCliente = new Map();
  for (const a of assinaturas) {
    if (!a?.cliente_id) continue;
    const arr = porCliente.get(a.cliente_id) ?? [];
    arr.push(a);
    porCliente.set(a.cliente_id, arr);
  }

  const out = new Map();
  for (const [clienteId, rows] of porCliente) {
    const best = [...rows].sort((a, b) => {
      const pa = prioridadeAssinatura(a);
      const pb = prioridadeAssinatura(b);
      if (pb !== pa) return pb - pa;
      const da = b.atualizado_em ?? b.data_inicio ?? b.criado_em ?? '';
      const db = a.atualizado_em ?? a.data_inicio ?? a.criado_em ?? '';
      return `${da}`.localeCompare(`${db}`);
    })[0];
    if (best) out.set(clienteId, best);
  }
  return out;
}

function mrrLocalDeAssinatura(a) {
  if (a.valor_atual_centavos != null) return Number(a.valor_atual_centavos) || 0;
  if (a.valor_mensal_atual != null) return Math.round(Number(a.valor_mensal_atual) * 100) || 0;
  return 0;
}

function nomeCliente(c) {
  return c.nome?.trim() || c.email?.trim() || `Cliente ${String(c.id).slice(0, 8)}`;
}

async function carregarDashboardAzoup(admin) {
  const { count: totalClientes, error: errCount } = await admin
    .from('clientes_azoup')
    .select('*', { count: 'exact', head: true });
  if (errCount) throw new Error(errCount.message);

  const [assinaturasRes, planosRes, clientesRes] = await Promise.all([
    admin.from('assinaturas_clientes').select(ASSINATURA_SELECT_COLS).limit(8000),
    admin.from('planos_assinatura').select('id,nome'),
    admin
      .from('clientes_azoup')
      .select(CLIENTE_SELECT_COLS)
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  if (assinaturasRes.error) throw new Error(assinaturasRes.error.message);
  if (planosRes.error) throw new Error(planosRes.error.message);
  if (clientesRes.error) throw new Error(clientesRes.error.message);

  const assinaturas = assinaturasRes.data ?? [];
  const planos = planosRes.data ?? [];
  const clientes = clientesRes.data ?? [];

  const planosMap = new Map();
  for (const p of planos) {
    planosMap.set(String(p.id), p.nome ?? String(p.id));
  }

  const porCliente = pickAssinaturaPorCliente(assinaturas);

  let clientesAssinaturaAtiva = 0;
  let clientesTrial = 0;
  let clientesInadimplentes = 0;
  let clientesCancelados = 0;
  let mrrLocalCentavos = 0;
  const porPlano = new Map();

  for (const a of porCliente.values()) {
    const grupo = classificarStatusAssinatura(a);
    if (grupo === 'ativa') clientesAssinaturaAtiva += 1;
    if (grupo === 'trial') clientesTrial += 1;
    if (grupo === 'inadimplente') clientesInadimplentes += 1;
    if (grupo === 'cancelada') clientesCancelados += 1;

    const centavos = mrrLocalDeAssinatura(a);
    if (centavos > 0 && grupo === 'ativa') mrrLocalCentavos += centavos;

    if (a.plano_id == null || `${a.plano_id}` === '') continue;
    const pid = String(a.plano_id);
    const bucket = porPlano.get(pid) ?? { ativos: 0, inativos: 0 };
    if (grupo === 'ativa' || grupo === 'trial') bucket.ativos += 1;
    else bucket.inativos += 1;
    porPlano.set(pid, bucket);
  }

  const planosClientes = [...porPlano.entries()]
    .map(([plano_id, counts]) => ({
      plano_id,
      nome: planosMap.get(plano_id) ?? `Plano #${plano_id}`,
      ativos: counts.ativos,
      inativos: counts.inativos,
      total: counts.ativos + counts.inativos,
    }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

  const listaClientes = clientes.map((c) => {
    const assinatura = porCliente.get(c.id) ?? null;
    const grupo = classificarStatusAssinatura(assinatura);
    const planoId = assinatura?.plano_id != null ? String(assinatura.plano_id) : null;
    return {
      id: c.id,
      nome: nomeCliente(c),
      email: c.email ?? null,
      telefone: c.telefone ?? null,
      created_at: c.created_at ?? null,
      plano_nome: planoId ? planosMap.get(planoId) ?? null : null,
      status_grupo: grupo,
      status_label: assinatura?.status ?? 'Sem assinatura',
      valor_centavos: assinatura ? mrrLocalDeAssinatura(assinatura) : 0,
    };
  });

  return {
    gerado_em: new Date().toISOString(),
    mrr_fonte: 'local',
    total_clientes: totalClientes ?? 0,
    clientes_assinatura_ativa: clientesAssinaturaAtiva,
    clientes_trial: clientesTrial,
    clientes_inadimplentes: clientesInadimplentes,
    clientes_cancelados: clientesCancelados,
    mrr_centavos: mrrLocalCentavos,
    mrr_bruto_centavos: mrrLocalCentavos,
    desconto_centavos: 0,
    assinaturas_com_desconto: 0,
    planos_clientes: planosClientes,
    clientes: listaClientes,
  };
}

module.exports = { carregarDashboardAzoup };
