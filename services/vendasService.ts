import { supabase } from '@/lib/supabase';
import { gerarBoletosParaVendaCriada } from '@/services/boletoParcelaService';
import type {
  NovaVendaInput,
  PagamentoParcelaRow,
  PagamentoVenda,
  ParcelaVenda,
  ParcelaVendaStatus,
  RegistrarPagamentoInput,
  Venda,
  VendaDetail,
  VendaFinanceiroStats,
  VendaListFilters,
  VendaListRow,
  VendaStatus,
} from '@/types/vendas';
import { formatDateTimeBRFromISO, toISODate } from '@/utils/date';
import { mapClienteJoinEmbed, isClienteCancelado } from '@/utils/clientesDbMapping';
import { serializeVendaDescricaoItens } from '@/utils/vendasDescricao';
import { centavosParaReais, reaisParaCentavos } from '@/utils/vendasParcelas';

export const VENDAS_PAGE_SIZE = 15;

export type ClienteVendaOption = {
  id: string;
  nome_cliente: string;
  nome_empresa: string | null;
};

export async function searchClientesVenda(
  userId: string,
  q: string,
  limit = 40,
): Promise<ClienteVendaOption[]> {
  let query = supabase
    .from('clientes')
    .select('id, nome_fantasia, nome, cancelado, ativo, data_cancelamento')
    .order('nome_fantasia', { ascending: true })
    .limit(limit);
  const t = q.trim();
  if (t) {
    const esc = t.replace(/%/g, '\\%').replace(/,/g, '');
    query = query.or(`nome_fantasia.ilike.%${esc}%,nome.ilike.%${esc}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as {
      id: string | number;
      nome_fantasia?: string | null;
      nome?: string | null;
      cancelado?: boolean | null;
      ativo?: string | null;
      data_cancelamento?: string | null;
    }[]
  )
    .filter((c) => !isClienteCancelado(c))
    .map((c) => {
      const join = mapClienteJoinEmbed(c);
      return {
        id: String(c.id),
        nome_cliente: join?.nome_cliente ?? '',
        nome_empresa: join?.nome_empresa ?? null,
      };
    });
}

function assertSomaParcelas(total: number, parcelas: NovaVendaInput['parcelas']) {
  const sum = parcelas.reduce((s, p) => s + reaisParaCentavos(p.valor), 0);
  const tot = reaisParaCentavos(total);
  if (sum !== tot) {
    throw new Error('A soma das parcelas deve ser igual ao valor total da venda.');
  }
}

export async function createVendaWithParcelas(
  userId: string,
  input: NovaVendaInput,
): Promise<{ id: string; avisoBoleto?: string }> {
  assertSomaParcelas(input.valor_total, input.parcelas);
  if (!input.parcelas.length) throw new Error('Inclua ao menos uma parcela.');

  const { descricao, itens_descricao } = serializeVendaDescricaoItens(input.descricao_itens);

  const { data: vendaRow, error: e1 } = await supabase
    .from('vendas')
    .insert({
      user_id: userId,
      cliente_id: input.cliente_id,
      descricao,
      itens_descricao,
      valor_total: input.valor_total,
      status: 'pendente' as VendaStatus,
    })
    .select('id')
    .single();

  if (e1 || !vendaRow) {
    throw new Error(e1?.message ?? 'Não foi possível criar a venda.');
  }
  const vendaId = vendaRow.id as string;

  const parcelasInsert = input.parcelas.map((p) => ({
    venda_id: vendaId,
    grupo_index: p.grupo_index,
    numero_parcela: p.numero_parcela,
    valor: p.valor,
    valor_pago: 0,
    data_vencimento: p.data_vencimento,
    status: 'pendente' as ParcelaVendaStatus,
    forma_pagamento_id: p.forma_pagamento_id,
  }));

  const { error: e2 } = await supabase.from('parcelas_venda').insert(parcelasInsert);
  if (e2) {
    await supabase.from('vendas').delete().eq('id', vendaId).eq('user_id', userId);
    throw new Error(e2.message);
  }

  let avisoBoleto: string | undefined;
  try {
    await gerarBoletosParaVendaCriada(userId, vendaId, { descricao });
  } catch (eb) {
    avisoBoleto = (eb as Error).message ?? 'Não foi possível gerar os carnês em A receber.';
    await supabase.from('vendas_financeiro_log').insert({
      venda_id: vendaId,
      user_id: userId,
      tipo: 'aviso_boleto',
      detalhe: { mensagem: avisoBoleto },
    });
  }

  await supabase.from('vendas_financeiro_log').insert({
    venda_id: vendaId,
    user_id: userId,
    tipo: 'venda_criada',
    detalhe: { parcelas: input.parcelas.length, boletos_parcelas: input.parcelas.length },
  });

  return avisoBoleto ? { id: vendaId, avisoBoleto } : { id: vendaId };
}

function intersectVendaIdSets(sets: string[][]): string[] {
  if (sets.length === 0) return [];
  if (sets.length === 1) return sets[0];
  return sets.slice(1).reduce((acc, s) => {
    const set = new Set(s);
    return acc.filter((id) => set.has(id));
  }, sets[0]);
}

export async function fetchVendasPage(params: {
  userId: string;
  filters: VendaListFilters;
  page: number;
}): Promise<{ rows: VendaListRow[]; hasMore: boolean }> {
  const from = params.page * VENDAS_PAGE_SIZE;
  const to = from + VENDAS_PAGE_SIZE - 1;

  const f = params.filters;
  const idConstraintSets: string[][] = [];

  if (f.formaPagamentoId !== 'todos') {
    const { data: parcRows, error: ep } = await supabase
      .from('parcelas_venda')
      .select('venda_id')
      .eq('forma_pagamento_id', f.formaPagamentoId);
    if (ep) throw new Error(ep.message);
    const set = new Set((parcRows as { venda_id: string }[] | null)?.map((r) => r.venda_id) ?? []);
    const ids = [...set];
    if (ids.length === 0) {
      return { rows: [], hasMore: false };
    }
    idConstraintSets.push(ids);
  }

  if (f.vencimentoDe || f.vencimentoAte) {
    let pq = supabase.from('parcelas_venda').select('venda_id');
    if (f.vencimentoDe) {
      pq = pq.gte('data_vencimento', f.vencimentoDe);
    }
    if (f.vencimentoAte) {
      pq = pq.lte('data_vencimento', f.vencimentoAte);
    }
    const { data: venRows, error: ev } = await pq;
    if (ev) throw new Error(ev.message);
    const set = new Set((venRows as { venda_id: string }[] | null)?.map((r) => r.venda_id) ?? []);
    const ids = [...set];
    if (ids.length === 0) {
      return { rows: [], hasMore: false };
    }
    idConstraintSets.push(ids);
  }

  if (f.pagamentoDe || f.pagamentoAte) {
    let payQ = supabase.from('pagamentos_venda').select('venda_id');
    if (f.pagamentoDe) {
      payQ = payQ.gte('data_pagamento', f.pagamentoDe);
    }
    if (f.pagamentoAte) {
      payQ = payQ.lte('data_pagamento', f.pagamentoAte);
    }
    const { data: payRows, error: epay } = await payQ;
    if (epay) throw new Error(epay.message);
    const set = new Set((payRows as { venda_id: string }[] | null)?.map((r) => r.venda_id) ?? []);
    const ids = [...set];
    if (ids.length === 0) {
      return { rows: [], hasMore: false };
    }
    idConstraintSets.push(ids);
  }

  let vendaIdsFilter: string[] | null = null;
  if (idConstraintSets.length > 0) {
    vendaIdsFilter = intersectVendaIdSets(idConstraintSets);
    if (vendaIdsFilter.length === 0) {
      return { rows: [], hasMore: false };
    }
  }

  let q = supabase
    .from('vendas')
    .select('*')
    .eq('user_id', params.userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (vendaIdsFilter) {
    q = q.in('id', vendaIdsFilter);
  }

  if (f.status !== 'todos') {
    q = q.eq('status', f.status);
  }
  if (f.clienteId !== 'todos') {
    q = q.eq('cliente_id', f.clienteId);
  }
  if (f.dataDe) {
    q = q.gte('created_at', `${f.dataDe}T00:00:00`);
  }
  if (f.dataAte) {
    q = q.lte('created_at', `${f.dataAte}T23:59:59`);
  }
  const term = f.search.trim().replace(/[%_,()]/g, '');
  if (term) {
    const esc = term.replace(/%/g, '\\%').replace(/,/g, '');
    q = q.ilike('descricao', `%${esc}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const baseRows = (data ?? []) as Venda[];

  const clienteIds = [...new Set(baseRows.map((r) => r.cliente_id).filter(Boolean))];
  const clienteMap = new Map<string, { nome_cliente: string; nome_empresa: string | null }>();
  if (clienteIds.length) {
    const { data: cliRows, error: ec } = await supabase
      .from('clientes')
      .select('id, nome_fantasia, nome')
      .in('id', clienteIds);
    if (ec) throw new Error(ec.message);
    for (const c of (cliRows ?? []) as {
      id: string | number;
      nome_fantasia?: string | null;
      nome?: string | null;
    }[]) {
      const join = mapClienteJoinEmbed(c);
      if (join) clienteMap.set(String(c.id), join);
    }
  }

  const ids = baseRows.map((r) => r.id);
  const parcelasAgg = new Map<
    string,
    { qtd: number; pago: number; pendente: number; formaIds: Set<string> }
  >();
  if (ids.length) {
    const { data: parcs, error: ePar } = await supabase
      .from('parcelas_venda')
      .select('venda_id, valor, valor_pago, forma_pagamento_id')
      .in('venda_id', ids);
    if (!ePar && parcs) {
      for (const p of parcs as {
        venda_id: string;
        valor: number;
        valor_pago: number;
        forma_pagamento_id: string;
      }[]) {
        const cur = parcelasAgg.get(p.venda_id) ?? {
          qtd: 0,
          pago: 0,
          pendente: 0,
          formaIds: new Set<string>(),
        };
        cur.qtd += 1;
        cur.pago += Number(p.valor_pago) || 0;
        cur.pendente += Math.max(0, (Number(p.valor) || 0) - (Number(p.valor_pago) || 0));
        cur.formaIds.add(p.forma_pagamento_id);
        parcelasAgg.set(p.venda_id, cur);
      }
    }
  }

  const rows: VendaListRow[] = baseRows.map((r) => {
    const c = clienteMap.get(r.cliente_id);
    const agg = parcelasAgg.get(r.id);
    return {
      ...r,
      cliente: c ?? null,
      qtd_parcelas: agg?.qtd ?? 0,
      valor_pago_sum: agg?.pago ?? 0,
      valor_pendente: agg?.pendente ?? 0,
    };
  });

  const hasMore = baseRows.length === VENDAS_PAGE_SIZE;
  return { rows, hasMore };
}

export async function fetchVendasExportAll(params: {
  userId: string;
  filters: VendaListFilters;
}): Promise<VendaListRow[]> {
  const all: VendaListRow[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore && page < 100) {
    const { rows, hasMore: more } = await fetchVendasPage({ ...params, page });
    all.push(...rows);
    hasMore = more;
    page += 1;
  }
  return all;
}

export async function fetchVendaDetail(userId: string, vendaId: string): Promise<VendaDetail | null> {
  const { data: v, error: e1 } = await supabase
    .from('vendas')
    .select('*')
    .eq('id', vendaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!v) return null;

  const vr = v as Venda;

  const { data: cli, error: ec } = await supabase
    .from('clientes')
    .select('id, nome_fantasia, nome')
    .eq('id', vr.cliente_id)
    .maybeSingle();
  if (ec) throw new Error(ec.message);
  if (!cli) throw new Error('Cliente não encontrado na venda.');
  const join = mapClienteJoinEmbed(cli as { nome_fantasia?: string | null; nome?: string | null });
  const cliente = {
    id: String((cli as { id: string | number }).id),
    nome_cliente: join?.nome_cliente ?? '',
    nome_empresa: join?.nome_empresa ?? null,
  };

  const { data: parcelas, error: e2 } = await supabase
    .from('parcelas_venda')
    .select('*, formas_pagamento(nome)')
    .eq('venda_id', vendaId)
    .order('numero_parcela', { ascending: true });
  if (e2) throw new Error(e2.message);

  const { data: pagamentos, error: e3 } = await supabase
    .from('pagamentos_venda')
    .select('*')
    .eq('venda_id', vendaId)
    .order('created_at', { ascending: false });
  if (e3) throw new Error(e3.message);

  const payIds = (pagamentos as PagamentoVenda[] | null)?.map((p) => p.id) ?? [];
  let ppRows: PagamentoParcelaRow[] = [];
  if (payIds.length) {
    const { data: pp, error: e4 } = await supabase
      .from('pagamento_parcelas')
      .select('*')
      .in('pagamento_id', payIds);
    if (e4) throw new Error(e4.message);
    ppRows = (pp as PagamentoParcelaRow[] | null) ?? [];
  }

  const plist = (parcelas ?? []) as (ParcelaVenda & {
    formas_pagamento?: { nome: string } | { nome: string }[] | null;
  })[];
  const parcelasNorm: ParcelaVenda[] = plist.map((p) => {
    const fp = p.formas_pagamento;
    const nome = Array.isArray(fp) ? fp[0]?.nome : fp?.nome;
    return {
      ...p,
      forma_pagamento: nome ? { id: p.forma_pagamento_id, nome } : null,
      formas_pagamento: undefined,
    };
  });

  return {
    ...vr,
    cliente: { id: cliente.id, nome_cliente: cliente.nome_cliente, nome_empresa: cliente.nome_empresa },
    parcelas: parcelasNorm,
    pagamentos: (pagamentos as PagamentoVenda[] | null) ?? [],
    pagamento_parcelas: ppRows,
  };
}

export async function fetchParcelaVendaById(parcelaId: string): Promise<ParcelaVenda | null> {
  const { data, error } = await supabase
    .from('parcelas_venda')
    .select('*')
    .eq('id', parcelaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ParcelaVenda | null) ?? null;
}

export async function fetchVendaParaNotaFiscal(
  userId: string,
  vendaId: string,
): Promise<{ id: string; cliente_id: string; valor_total: number; descricao: string } | null> {
  const { data, error } = await supabase
    .from('vendas')
    .select('id, cliente_id, valor_total, descricao')
    .eq('id', vendaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { id: string; cliente_id: string; valor_total: number; descricao: string | null };
  return {
    id: row.id,
    cliente_id: row.cliente_id,
    valor_total: row.valor_total,
    descricao: row.descricao ?? '',
  };
}

function nextParcelaDbStatus(valor: number, valorPago: number): ParcelaVendaStatus {
  const vc = reaisParaCentavos(valor);
  const pc = reaisParaCentavos(valorPago);
  if (pc <= 0) return 'pendente';
  if (pc >= vc) return 'pago';
  return 'parcial';
}

async function atualizarStatusVenda(vendaId: string, userId: string) {
  const { data: ps, error } = await supabase
    .from('parcelas_venda')
    .select('valor, valor_pago, status')
    .eq('venda_id', vendaId);
  if (error) return;
  const rows = (ps ?? []) as { valor: number; valor_pago: number; status: string }[];
  if (!rows.length) return;
  const allPaid = rows.every((r) => reaisParaCentavos(r.valor_pago) >= reaisParaCentavos(r.valor));
  const anyPaid = rows.some((r) => reaisParaCentavos(r.valor_pago) > 0);
  const allCancelled = rows.every((r) => r.status === 'cancelado');
  let status: VendaStatus = 'pendente';
  if (allCancelled) status = 'cancelada';
  else if (allPaid) status = 'quitada';
  else if (anyPaid) status = 'parcial';

  await supabase.from('vendas').update({ status }).eq('id', vendaId).eq('user_id', userId);
}

export async function registrarPagamentoVenda(
  userId: string,
  vendaId: string,
  input: RegistrarPagamentoInput,
): Promise<void> {
  const valorCent = reaisParaCentavos(input.valor_pago);
  if (valorCent <= 0) throw new Error('Informe um valor de pagamento válido.');

  const { data: parcelas, error: e0 } = await supabase
    .from('parcelas_venda')
    .select('*')
    .eq('venda_id', vendaId)
    .order('numero_parcela', { ascending: true });
  if (e0) throw new Error(e0.message);
  const plist = (parcelas as ParcelaVenda[] | null) ?? [];

  const abertas = plist.filter(
    (p) => p.status !== 'cancelado' && reaisParaCentavos(p.valor_pago) < reaisParaCentavos(p.valor),
  );

  const aloc: { parcela_id: string; centavos: number }[] = [];
  if (input.alocacao_manual?.length) {
    let sum = 0;
    for (const a of input.alocacao_manual) {
      const c = reaisParaCentavos(a.valor);
      if (c <= 0) continue;
      aloc.push({ parcela_id: a.parcela_id, centavos: c });
      sum += c;
    }
    if (sum !== valorCent) throw new Error('A soma da alocação manual deve ser igual ao valor pago.');
  } else {
    let rest = valorCent;
    for (const p of abertas) {
      if (rest <= 0) break;
      const open = reaisParaCentavos(p.valor) - reaisParaCentavos(p.valor_pago);
      if (open <= 0) continue;
      const apply = Math.min(open, rest);
      aloc.push({ parcela_id: p.id, centavos: apply });
      rest -= apply;
    }
    if (rest > 0) throw new Error('Valor excede o saldo em aberto das parcelas.');
  }

  const { data: payIns, error: e1 } = await supabase
    .from('pagamentos_venda')
    .insert({
      venda_id: vendaId,
      user_id: userId,
      data_pagamento: input.data_pagamento,
      valor_pago: input.valor_pago,
      observacao: input.observacao.trim() || null,
    })
    .select('id')
    .single();
  if (e1 || !payIns) throw new Error(e1?.message ?? 'Erro ao registrar pagamento.');
  const pagamentoId = payIns.id as string;

  const ppRows = aloc.map((a) => ({
    pagamento_id: pagamentoId,
    parcela_id: a.parcela_id,
    valor_aplicado: centavosParaReais(a.centavos),
  }));
  const { error: e2 } = await supabase.from('pagamento_parcelas').insert(ppRows);
  if (e2) {
    await supabase.from('pagamentos_venda').delete().eq('id', pagamentoId);
    throw new Error(e2.message);
  }

  for (const a of aloc) {
    const p = plist.find((x) => x.id === a.parcela_id);
    if (!p) continue;
    const novoPago = centavosParaReais(reaisParaCentavos(p.valor_pago) + a.centavos);
    const st = nextParcelaDbStatus(p.valor, novoPago);
    const { error: eu } = await supabase
      .from('parcelas_venda')
      .update({ valor_pago: novoPago, status: st })
      .eq('id', p.id)
      .eq('venda_id', vendaId);
    if (eu) throw new Error(eu.message);

    if (st === 'pago') {
      await supabase
        .from('boletos_parcela_venda')
        .update({ status_registro: 'pago', data_liquidacao_sicoob: input.data_pagamento })
        .eq('parcela_id', p.id)
        .eq('user_id', userId)
        .in('status_registro', ['registrado', 'pendente', 'informativo']);
    }
  }

  await atualizarStatusVenda(vendaId, userId);
  await supabase.from('vendas_financeiro_log').insert({
    venda_id: vendaId,
    user_id: userId,
    tipo: 'pagamento_registrado',
    detalhe: { pagamento_id: pagamentoId, valor: input.valor_pago, parcelas: aloc },
  });
}

export async function fetchVendaFinanceiroStats(userId: string): Promise<VendaFinanceiroStats> {
  const { data: vendas, error: e1 } = await supabase
    .from('vendas')
    .select('id, valor_total, status')
    .eq('user_id', userId)
    .neq('status', 'cancelada');
  if (e1) throw new Error(e1.message);
  const vs = (vendas as Pick<Venda, 'id' | 'valor_total' | 'status'>[] | null) ?? [];
  const ids = vs.map((v) => v.id);
  let totalVendido = 0;
  let totalRecebido = 0;
  let totalPendente = 0;
  let parcelasAtrasadas = 0;
  const hoje = toISODate(new Date());

  for (const v of vs) {
    totalVendido += Number(v.valor_total) || 0;
  }

  if (ids.length) {
    const { data: parcs, error: e2 } = await supabase
      .from('parcelas_venda')
      .select('valor, valor_pago, data_vencimento, status')
      .in('venda_id', ids);
    if (!e2 && parcs) {
      for (const p of parcs as {
        valor: number;
        valor_pago: number;
        data_vencimento: string;
        status: string;
      }[]) {
        const vc = reaisParaCentavos(p.valor);
        const pc = reaisParaCentavos(p.valor_pago);
        totalRecebido += Number(p.valor_pago) || 0;
        totalPendente += Math.max(0, centavosParaReais(vc - pc));
        if (
          p.status !== 'cancelado' &&
          p.status !== 'pago' &&
          p.data_vencimento < hoje &&
          pc < vc
        ) {
          parcelasAtrasadas += 1;
        }
      }
    }
  }

  const vendasAbertas = vs.filter((v) => v.status === 'pendente' || v.status === 'parcial').length;

  return {
    totalVendido,
    totalRecebido,
    totalPendente,
    parcelasAtrasadas,
    vendasAbertas,
  };
}

export async function cancelarVenda(userId: string, vendaId: string): Promise<void> {
  const { data: ps } = await supabase
    .from('parcelas_venda')
    .select('valor_pago')
    .eq('venda_id', vendaId);
  const any = (ps as { valor_pago: number }[] | null)?.some((p) => reaisParaCentavos(p.valor_pago) > 0);
  if (any) throw new Error('Não é possível cancelar venda com pagamentos registrados.');
  await supabase.from('parcelas_venda').update({ status: 'cancelado' }).eq('venda_id', vendaId);
  await supabase.from('vendas').update({ status: 'cancelada' }).eq('id', vendaId).eq('user_id', userId);
  await supabase.from('vendas_financeiro_log').insert({
    venda_id: vendaId,
    user_id: userId,
    tipo: 'venda_cancelada',
    detalhe: {},
  });
}

export function parcelaStatusVisual(p: ParcelaVenda): ParcelaVendaStatus {
  if (p.status === 'cancelado' || p.status === 'pago') return p.status;
  const hoje = toISODate(new Date());
  if (p.data_vencimento < hoje && reaisParaCentavos(p.valor_pago) < reaisParaCentavos(p.valor)) {
    return 'atrasado';
  }
  return p.status;
}

export async function fetchVendasFinanceiroLog(vendaId: string): Promise<
  { id: string; tipo: string; detalhe: unknown; created_at: string }[]
> {
  const { data, error } = await supabase
    .from('vendas_financeiro_log')
    .select('id, tipo, detalhe, created_at')
    .eq('venda_id', vendaId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as { id: string; tipo: string; detalhe: unknown; created_at: string }[]) ?? [];
}
