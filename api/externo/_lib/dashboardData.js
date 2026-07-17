const {
  classificarStatusAssinatura,
  prioridadeAssinatura,
} = require('./assinaturaStatus');
const { computeMrrStripe, onlyDigits } = require('./mrrStripe');

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

function rotuloEmpresaMatriz(empresa) {
  const fantasia = `${empresa?.nome_fantasia ?? ''}`.trim();
  if (fantasia) return fantasia;
  return `${empresa?.razao_social ?? ''}`.trim() || null;
}

function pickEnderecoEmpresa(empresa) {
  if (!empresa || typeof empresa !== 'object') {
    return { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null };
  }
  const cep = empresa.cep ?? empresa.cep_empresa ?? null;
  const logradouro =
    empresa.logradouro ?? empresa.rua ?? empresa.endereco ?? empresa.endereco_logradouro ?? null;
  const numero = empresa.numero ?? empresa.numero_endereco ?? null;
  const complemento = empresa.complemento ?? null;
  const bairro = empresa.bairro ?? null;
  const cidade = empresa.cidade ?? empresa.cidade_nome ?? null;
  const uf = empresa.uf ?? empresa.estado ?? empresa.estado_sigla ?? null;
  return {
    cep: cep != null ? `${cep}`.trim() || null : null,
    logradouro: logradouro != null ? `${logradouro}`.trim() || null : null,
    numero: numero != null ? `${numero}`.trim() || null : null,
    complemento: complemento != null ? `${complemento}`.trim() || null : null,
    bairro: bairro != null ? `${bairro}`.trim() || null : null,
    cidade: cidade != null ? `${cidade}`.trim() || null : null,
    uf: uf != null ? `${uf}`.trim().toUpperCase().slice(0, 2) || null : null,
  };
}

async function carregarDashboardAzoup(admin) {
  const { count: totalClientes, error: errCount } = await admin
    .from('clientes_azoup')
    .select('*', { count: 'exact', head: true });
  if (errCount) throw new Error(errCount.message);

  const [assinaturasRes, planosRes, clientesRes, empresasRes] = await Promise.all([
    admin.from('assinaturas_clientes').select(ASSINATURA_SELECT_COLS).limit(8000),
    admin.from('planos_assinatura').select('id,nome'),
    admin
      .from('clientes_azoup')
      .select(CLIENTE_SELECT_COLS)
      .order('created_at', { ascending: false })
      .limit(2000),
    admin
      .from('empresas')
      .select('*')
      .eq('empresa_matriz', true)
      .limit(5000),
  ]);

  if (assinaturasRes.error) throw new Error(assinaturasRes.error.message);
  if (planosRes.error) throw new Error(planosRes.error.message);
  if (clientesRes.error) throw new Error(clientesRes.error.message);
  // Empresas opcional: se a tabela falhar, segue sem CNPJ
  const empresas = empresasRes.error ? [] : empresasRes.data ?? [];

  const assinaturas = assinaturasRes.data ?? [];
  const planos = planosRes.data ?? [];
  const clientes = clientesRes.data ?? [];

  const planosMap = new Map();
  for (const p of planos) {
    planosMap.set(String(p.id), p.nome ?? String(p.id));
  }

  const empresaPorCliente = new Map();
  for (const e of empresas) {
    if (!e?.cliente_id) continue;
    if (!empresaPorCliente.has(e.cliente_id)) empresaPorCliente.set(e.cliente_id, e);
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

  let mrrStripe = null;
  try {
    mrrStripe = await computeMrrStripe(admin, porCliente);
  } catch (e) {
    console.warn('[azoup-dashboard] MRR Stripe falhou, usando local:', e?.message ?? e);
    mrrStripe = null;
  }

  const listaClientes = clientes.map((c) => {
    const assinatura = porCliente.get(c.id) ?? null;
    const grupo = classificarStatusAssinatura(assinatura);
    const planoId = assinatura?.plano_id != null ? String(assinatura.plano_id) : null;
    const localCentavos = assinatura ? mrrLocalDeAssinatura(assinatura) : 0;
    const stripeVal = mrrStripe?.porCliente?.get(c.id) ?? null;
    const valorLiquido = stripeVal?.liquido_centavos ?? localCentavos;
    const valorBruto = stripeVal?.bruto_centavos ?? localCentavos;
    const empresa = empresaPorCliente.get(c.id) ?? null;
    const cnpj = onlyDigits(empresa?.cnpj);
    const endereco = pickEnderecoEmpresa(empresa);
    return {
      id: c.id,
      nome: nomeCliente(c),
      email: c.email ?? null,
      telefone: c.telefone ?? null,
      created_at: c.created_at ?? null,
      plano_nome: planoId ? planosMap.get(planoId) ?? null : null,
      status_grupo: grupo,
      status_label: assinatura?.status ?? 'Sem assinatura',
      valor_centavos: valorLiquido,
      valor_bruto_centavos: valorBruto,
      desconto_centavos: stripeVal?.desconto_centavos ?? 0,
      empresa_matriz_nome: rotuloEmpresaMatriz(empresa),
      empresa_matriz_cnpj: cnpj.length === 14 ? cnpj : cnpj || null,
      pode_emitir_nf: cnpj.length === 14,
      endereco,
    };
  });

  return {
    gerado_em: new Date().toISOString(),
    mrr_fonte: mrrStripe ? 'stripe' : 'local',
    total_clientes: totalClientes ?? 0,
    clientes_assinatura_ativa: clientesAssinaturaAtiva,
    clientes_trial: clientesTrial,
    clientes_inadimplentes: clientesInadimplentes,
    clientes_cancelados: clientesCancelados,
    mrr_centavos: mrrStripe?.mrr_centavos ?? mrrLocalCentavos,
    mrr_bruto_centavos: mrrStripe?.mrr_bruto_centavos ?? mrrLocalCentavos,
    desconto_centavos: mrrStripe?.desconto_centavos ?? 0,
    assinaturas_com_desconto: mrrStripe?.assinaturas_com_desconto ?? 0,
    planos_clientes: planosClientes,
    clientes: listaClientes,
  };
}

/**
 * Detalhe de um cliente Azoup para sincronizar e emitir NFS-e no SistemaJessica.
 */
async function carregarClienteAzoupParaNf(admin, azoupClienteId) {
  const id = `${azoupClienteId ?? ''}`.trim();
  if (!id) throw new Error('cliente_id obrigatório.');

  const { data: cliente, error: cErr } = await admin
    .from('clientes_azoup')
    .select(CLIENTE_SELECT_COLS)
    .eq('id', id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!cliente) throw new Error('Cliente Azoup não encontrado.');

  const [assinaturasRes, empresasRes] = await Promise.all([
    admin.from('assinaturas_clientes').select(ASSINATURA_SELECT_COLS).eq('cliente_id', id).limit(50),
    admin.from('empresas').select('*').eq('cliente_id', id).eq('empresa_matriz', true).limit(5),
  ]);
  if (assinaturasRes.error) throw new Error(assinaturasRes.error.message);
  if (empresasRes.error) throw new Error(empresasRes.error.message);

  const porCliente = pickAssinaturaPorCliente(assinaturasRes.data ?? []);
  const assinatura = porCliente.get(id) ?? null;
  const empresa = (empresasRes.data ?? [])[0] ?? null;
  const cnpj = onlyDigits(empresa?.cnpj);
  const endereco = pickEnderecoEmpresa(empresa);

  let valor_centavos = assinatura ? mrrLocalDeAssinatura(assinatura) : 0;
  let valor_bruto_centavos = valor_centavos;
  try {
    const mrr = await computeMrrStripe(admin, porCliente);
    const v = mrr?.porCliente?.get(id);
    if (v) {
      valor_centavos = v.liquido_centavos;
      valor_bruto_centavos = v.bruto_centavos;
    }
  } catch {
    /* mantém local */
  }

  return {
    id: cliente.id,
    nome: nomeCliente(cliente),
    email: cliente.email ?? null,
    telefone: cliente.telefone ?? null,
    empresa_matriz_nome: rotuloEmpresaMatriz(empresa),
    empresa_matriz_razao: empresa?.razao_social?.trim() || null,
    empresa_matriz_cnpj: cnpj.length >= 11 ? cnpj : null,
    endereco,
    plano_id: assinatura?.plano_id != null ? String(assinatura.plano_id) : null,
    status_grupo: classificarStatusAssinatura(assinatura),
    status_label: assinatura?.status ?? 'Sem assinatura',
    valor_centavos,
    valor_bruto_centavos,
  };
}

module.exports = { carregarDashboardAzoup, carregarClienteAzoupParaNf };
