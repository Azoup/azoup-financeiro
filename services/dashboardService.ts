import { supabase } from '@/lib/supabase';
import { getSegmentoNomePorCodigo } from '@/services/segmentoClienteService';
import { fetchVendaFinanceiroStats } from '@/services/vendasService';
import { toISODate } from '@/utils/date';
import { isClienteCancelado } from '@/utils/clientesDbMapping';
import { centavosParaReais, reaisParaCentavos } from '@/utils/vendasParcelas';

export type DashboardOverview = {
  geradoEm: string;
  clientes: {
    ativos: number;
    cancelados: number;
    total: number;
    somaMensalidadeAtivos: number;
    ticketMedio: number;
    porSegmento: { codigo: string; nome: string; qtd: number }[];
  };
  mensalidades: {
    totalGeradas: number;
    abertas: number;
    atrasadas: number;
    quitadas: number;
    valorPendente: number;
    valorRecebido: number;
    proximosVencimentos7d: number;
  };
  vendas: {
    totalVendas: number;
    canceladas: number;
    totalVendido: number;
    totalRecebido: number;
    totalPendente: number;
    parcelasAtrasadas: number;
    vendasAbertas: number;
    taxaRecebimentoPct: number;
  };
  contasReceber: {
    totalDocumentos: number;
    origemVenda: number;
    origemMensalidade: number;
    valorTotalDocumentos: number;
  };
  /** Mensalidades pendentes + parcelas de vendas pendentes. */
  totalReceberConsolidado: number;
  alertas: { nivel: 'danger' | 'warning' | 'info'; texto: string }[];
};

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toISODate(dt);
}

export async function fetchDashboardOverview(userId: string): Promise<DashboardOverview> {
  const hoje = toISODate(new Date());
  const ate7 = addDaysIso(hoje, 7);

  const [
    clientesRes,
    mensRes,
    vendasAllRes,
    boletosRes,
    vendaStats,
    nomeMap,
  ] = await Promise.all([
    supabase
      .from('clientes')
      .select('cancelado, ativo, data_cancelamento, mensalidade, segmento_cliente_codigo, tipo_cliente'),
    supabase
      .from('mensalidades')
      .select('valor, valor_pago, data_vencimento, status')
      .eq('user_id', userId),
    supabase.from('vendas').select('id, status, valor_total').eq('user_id', userId),
    supabase
      .from('boletos_parcela_venda')
      .select('valor_documento, parcela_id, venda_id')
      .eq('user_id', userId),
    fetchVendaFinanceiroStats(userId),
    getSegmentoNomePorCodigo(),
  ]);

  if (clientesRes.error) throw new Error(clientesRes.error.message);
  if (mensRes.error) throw new Error(mensRes.error.message);
  if (vendasAllRes.error) throw new Error(vendasAllRes.error.message);
  if (boletosRes.error) throw new Error(boletosRes.error.message);

  const clientes = (clientesRes.data ?? []) as {
    cancelado?: boolean | null;
    ativo?: string | null;
    data_cancelamento?: string | null;
    mensalidade: number | null;
    segmento_cliente_codigo?: string | null;
    tipo_cliente?: string | null;
  }[];

  const ativos = clientes.filter((c) => !isClienteCancelado(c));
  const cancelados = clientes.filter((c) => isClienteCancelado(c));
  const somaMensalidadeAtivos = ativos.reduce((s, c) => s + (Number(c.mensalidade) || 0), 0);
  const ticketMedio = ativos.length ? somaMensalidadeAtivos / ativos.length : 0;

  const segCount = new Map<string, number>();
  for (const c of ativos) {
    const cod = (c.segmento_cliente_codigo ?? 'DIVERSOS').trim() || 'DIVERSOS';
    segCount.set(cod, (segCount.get(cod) ?? 0) + 1);
  }
  const porSegmento = [...segCount.entries()]
    .map(([codigo, qtd]) => ({
      codigo,
      nome: nomeMap.get(codigo) ?? codigo,
      qtd,
    }))
    .sort((a, b) => b.qtd - a.qtd)
    .slice(0, 6);

  let mensTotal = 0;
  let mensAbertas = 0;
  let mensAtrasadas = 0;
  let mensQuitadas = 0;
  let mensPendente = 0;
  let mensRecebido = 0;
  let proximos7 = 0;

  for (const m of (mensRes.data ?? []) as {
    valor: number;
    valor_pago: number;
    data_vencimento: string;
    status: string;
  }[]) {
    mensTotal += 1;
    if (m.status === 'cancelado') continue;
    const vc = reaisParaCentavos(m.valor);
    const pc = reaisParaCentavos(m.valor_pago);
    const open = Math.max(0, vc - pc);
    mensRecebido += Number(m.valor_pago) || 0;
    mensPendente += centavosParaReais(open);
    if (pc >= vc) {
      mensQuitadas += 1;
    } else {
      mensAbertas += 1;
      if (m.data_vencimento < hoje) mensAtrasadas += 1;
      else if (m.data_vencimento >= hoje && m.data_vencimento <= ate7) proximos7 += 1;
    }
  }

  const vendasAll = (vendasAllRes.data ?? []) as { status: string }[];
  const totalVendas = vendasAll.length;
  const vendasCanceladas = vendasAll.filter((v) => v.status === 'cancelada').length;

  const taxaRecebimentoPct =
    vendaStats.totalVendido > 0
      ? Math.min(100, Math.round((vendaStats.totalRecebido / vendaStats.totalVendido) * 100))
      : 0;

  const boletos = (boletosRes.data ?? []) as {
    valor_documento: number;
    parcela_id: string | null;
    venda_id: string | null;
  }[];
  let origemVenda = 0;
  let origemMen = 0;
  let valorDocs = 0;
  for (const b of boletos) {
    valorDocs += Number(b.valor_documento) || 0;
    // Carnê de mensalidade (migration 018): sem vínculo com parcela/venda.
    const isMensalidade = !b.parcela_id && !b.venda_id;
    if (isMensalidade) origemMen += 1;
    else origemVenda += 1;
  }

  const totalReceberConsolidado = mensPendente + vendaStats.totalPendente;
  const alertas: DashboardOverview['alertas'] = [];

  if (mensAtrasadas > 0) {
    alertas.push({
      nivel: 'danger',
      texto: `${mensAtrasadas} mensalidade(s) gerada(s) em atraso.`,
    });
  }
  if (vendaStats.parcelasAtrasadas > 0) {
    alertas.push({
      nivel: 'danger',
      texto: `${vendaStats.parcelasAtrasadas} parcela(s) de venda em atraso.`,
    });
  }
  if (vendaStats.vendasAbertas > 0) {
    alertas.push({
      nivel: 'warning',
      texto: `${vendaStats.vendasAbertas} venda(s) com recebimento em aberto.`,
    });
  }
  if (proximos7 > 0) {
    alertas.push({
      nivel: 'info',
      texto: `${proximos7} mensalidade(s) vencem nos próximos 7 dias.`,
    });
  }
  if (cancelados.length > 0) {
    alertas.push({
      nivel: 'info',
      texto: `${cancelados.length} cliente(s) cancelado(s) no cadastro.`,
    });
  }
  if (alertas.length === 0) {
    alertas.push({
      nivel: 'info',
      texto: 'Nenhum alerta crítico no momento. Continue acompanhando os módulos abaixo.',
    });
  }

  return {
    geradoEm: new Date().toISOString(),
    clientes: {
      ativos: ativos.length,
      cancelados: cancelados.length,
      total: clientes.length,
      somaMensalidadeAtivos,
      ticketMedio,
      porSegmento,
    },
    mensalidades: {
      totalGeradas: mensTotal,
      abertas: mensAbertas,
      atrasadas: mensAtrasadas,
      quitadas: mensQuitadas,
      valorPendente: mensPendente,
      valorRecebido: mensRecebido,
      proximosVencimentos7d: proximos7,
    },
    vendas: {
      totalVendas,
      canceladas: vendasCanceladas,
      totalVendido: vendaStats.totalVendido,
      totalRecebido: vendaStats.totalRecebido,
      totalPendente: vendaStats.totalPendente,
      parcelasAtrasadas: vendaStats.parcelasAtrasadas,
      vendasAbertas: vendaStats.vendasAbertas,
      taxaRecebimentoPct,
    },
    contasReceber: {
      totalDocumentos: boletos.length,
      origemVenda,
      origemMensalidade: origemMen,
      valorTotalDocumentos: valorDocs,
    },
    totalReceberConsolidado,
    alertas,
  };
}
