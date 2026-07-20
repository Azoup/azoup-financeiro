import { supabase } from '@/lib/supabase';
import { gerarBoletosParaMensalidades } from '@/services/boletoParcelaService';
import { gerarNotasFiscaisParaMensalidades } from '@/services/notaFiscalService';
import type {
  CriarMensalidadeGeradaInput,
  MensalidadeGerada,
  MensalidadeGeradaStatusDb,
  PagamentoMensalidadeGerada,
  RegistrarPagamentoMensalidadeGeradaInput,
} from '@/types/mensalidadeGerada';
import { toISODate } from '@/utils/date';
import { mapClienteJoinEmbed } from '@/utils/clientesDbMapping';
import {
  montarParcelasAnuais,
  normalizeParcelasAnuais,
  normalizeTipoFaturamento,
} from '@/utils/faturamentoCliente';
import { calcProximoVencimentoIso } from '@/utils/mensalidadeVencimento';
import { reaisParaCentavos } from '@/utils/vendasParcelas';

function cents(n: number) {
  return reaisParaCentavos(n);
}

function newLoteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lote-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type MensalidadeInsertRow = {
  user_id: string;
  cliente_id: string;
  valor: number;
  valor_pago: number;
  data_vencimento: string;
  competencia: string | null;
  status: MensalidadeGeradaStatusDb;
  lote_faturamento_id?: string | null;
  parcela_numero?: number | null;
  parcela_total?: number | null;
};

export function mensalidadeGeradaStatusVisual(
  m: Pick<MensalidadeGerada, 'status' | 'data_vencimento' | 'valor' | 'valor_pago'>,
): MensalidadeGeradaStatusDb {
  if (m.status === 'cancelado') return 'cancelado';
  if (cents(m.valor_pago) >= cents(m.valor)) return 'pago';
  if (cents(m.valor_pago) > 0 && cents(m.valor_pago) < cents(m.valor)) return 'parcial';
  const hoje = toISODate(new Date());
  if (m.data_vencimento < hoje) return 'atrasado';
  return 'pendente';
}

export function podeRegistrarPagamentoMensalidadeGerada(
  m: Pick<MensalidadeGerada, 'status' | 'data_vencimento' | 'valor' | 'valor_pago'>,
): boolean {
  if (m.status === 'cancelado' || m.status === 'pago') return false;
  if (cents(m.valor_pago) >= cents(m.valor)) return false;
  const vis = mensalidadeGeradaStatusVisual(m);
  return vis === 'pendente' || vis === 'parcial' || vis === 'atrasado';
}

function nextDbStatusAfterPay(valor: number, valorPagoNovo: number): MensalidadeGeradaStatusDb {
  const vc = cents(valor);
  const pc = cents(valorPagoNovo);
  if (pc >= vc) return 'pago';
  if (pc > 0) return 'parcial';
  return 'pendente';
}

export async function fetchMensalidadesGeradasHistorico(userId: string): Promise<MensalidadeGerada[]> {
  const { data, error } = await supabase
    .from('mensalidades')
    .select('*, clientes(nome_fantasia, nome)')
    .eq('user_id', userId)
    .order('data_geracao', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as (MensalidadeGerada & { clientes?: { nome_fantasia?: string; nome?: string } | null })[]).map(
    (row) => {
      const { clientes, ...rest } = row;
      return { ...rest, clientes: mapClienteJoinEmbed(clientes) };
    },
  );
}

export async function fetchMensalidadeGeradaById(
  userId: string,
  mensalidadeId: string,
): Promise<MensalidadeGerada | null> {
  const { data, error } = await supabase
    .from('mensalidades')
    .select('*')
    .eq('id', mensalidadeId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MensalidadeGerada | null) ?? null;
}

export async function fetchMensalidadesGeradasPorCliente(
  userId: string,
  clienteId: string,
): Promise<MensalidadeGerada[]> {
  const { data, error } = await supabase
    .from('mensalidades')
    .select('*')
    .eq('user_id', userId)
    .eq('cliente_id', clienteId)
    .order('data_geracao', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as MensalidadeGerada[] | null) ?? [];
}

export async function fetchPagamentosMensalidadeGerada(
  mensalidadeId: string,
): Promise<PagamentoMensalidadeGerada[]> {
  const { data, error } = await supabase
    .from('pagamentos_mensalidades')
    .select('*')
    .eq('mensalidade_id', mensalidadeId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as PagamentoMensalidadeGerada[] | null) ?? [];
}

export async function fetchPagamentosMensalidadesPorIds(
  mensalidadeIds: string[],
): Promise<Record<string, PagamentoMensalidadeGerada[]>> {
  const map: Record<string, PagamentoMensalidadeGerada[]> = {};
  if (!mensalidadeIds.length) return map;

  const { data, error } = await supabase
    .from('pagamentos_mensalidades')
    .select('*')
    .in('mensalidade_id', mensalidadeIds)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of (data as PagamentoMensalidadeGerada[] | null) ?? []) {
    const list = map[row.mensalidade_id] ?? [];
    list.push(row);
    map[row.mensalidade_id] = list;
  }
  return map;
}

/** Última data de vencimento gerada por cliente (mensalidades não canceladas). */
export async function fetchUltimoVencimentoMensalidadePorCliente(
  userId: string,
  clienteIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!clienteIds.length) return map;

  const { data, error } = await supabase
    .from('mensalidades')
    .select('cliente_id, data_vencimento')
    .eq('user_id', userId)
    .in('cliente_id', clienteIds)
    .neq('status', 'cancelado')
    .order('data_vencimento', { ascending: false });

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as { cliente_id: string; data_vencimento: string }[]) {
    if (!map.has(row.cliente_id)) {
      map.set(row.cliente_id, row.data_vencimento);
    }
  }
  return map;
}

export async function resolverVencimentoMensalidadeCliente(
  userId: string,
  clienteId: string,
  opts?: {
    diaVencimento?: number | null;
    dataInicio?: string | null;
    ultimoVencimento?: string | null;
    override?: string | null;
  },
): Promise<string> {
  if (opts?.override) return opts.override;

  let diaVencimento = opts?.diaVencimento ?? null;
  let dataInicio = opts?.dataInicio ?? null;
  let ultimo = opts?.ultimoVencimento ?? null;

  if (diaVencimento == null || dataInicio == null || ultimo == null) {
    const ultimos = await fetchUltimoVencimentoMensalidadePorCliente(userId, [clienteId]);
    ultimo = ultimo ?? ultimos.get(clienteId) ?? null;
    if (diaVencimento == null || dataInicio == null) {
      const { data: c, error } = await supabase
        .from('clientes')
        .select('dia_vencimento, data_inicio')
        .eq('id', clienteId)
        .maybeSingle();
      if (error) {
        if (/dia_vencimento|column|schema cache/i.test(error.message)) {
          const { data: c2, error: e2 } = await supabase
            .from('clientes')
            .select('data_inicio')
            .eq('id', clienteId)
            .maybeSingle();
          if (e2) throw new Error(e2.message);
          dataInicio = dataInicio ?? (c2 as { data_inicio: string | null } | null)?.data_inicio ?? null;
        } else {
          throw new Error(error.message);
        }
      } else {
        const row = c as { dia_vencimento: number | null; data_inicio: string | null } | null;
        if (diaVencimento == null && row?.dia_vencimento != null) {
          diaVencimento = Number(row.dia_vencimento);
        }
        dataInicio = dataInicio ?? row?.data_inicio ?? null;
      }
    }
  }

  const iso = calcProximoVencimentoIso({
    diaVencimento,
    dataInicio,
    ultimoVencimento: ultimo,
  });
  if (!iso) {
    throw new Error(
      'Informe o dia de vencimento no cadastro do cliente (1–31) ou defina a data manualmente na geração.',
    );
  }
  return iso;
}

export async function criarMensalidadeGerada(
  userId: string,
  input: CriarMensalidadeGeradaInput,
): Promise<{ id: string; avisoBoleto?: string }> {
  const dataVencimento =
    input.data_vencimento?.trim() ||
    (await resolverVencimentoMensalidadeCliente(userId, input.cliente_id));

  const { data, error } = await supabase
    .from('mensalidades')
    .insert({
      user_id: userId,
      cliente_id: input.cliente_id,
      valor: input.valor,
      valor_pago: 0,
      data_vencimento: dataVencimento,
      competencia: input.competencia?.trim() || null,
      status: 'pendente' as MensalidadeGeradaStatusDb,
      observacao: input.observacao?.trim() || null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Não foi possível registrar a mensalidade.');
  const mensalidadeId = data.id as string;

  try {
    const { avisoSicoob } = await gerarBoletosParaMensalidades(userId, [
      {
        id: mensalidadeId,
        cliente_id: input.cliente_id,
        valor: input.valor,
        data_vencimento: dataVencimento,
        competencia: input.competencia ?? null,
      },
    ]);
    return { id: mensalidadeId, avisoBoleto: avisoSicoob };
  } catch (eb) {
    await supabase.from('mensalidades').delete().eq('id', mensalidadeId).eq('user_id', userId);
    throw new Error((eb as Error).message ?? 'Falha ao gerar carnê em contas a receber.');
  }
}

export async function criarMensalidadesGeradasLote(params: {
  userId: string;
  clienteIds: string[];
  /** Valor excepcional por cliente, aplicado somente às mensalidades deste lote. */
  valoresPorCliente?: Record<string, number>;
  /** Se informado, usa a mesma data para todos os clientes do lote. */
  dataVencimentoOverride?: string | null;
  competencia?: string | null;
  /** Gera NF-e (SEFAZ) para clientes com emite_nf após criar mensalidades. */
  gerarNotaFiscal?: boolean;
  /** CNPJ/emitente da NFS-e (quando há 2 cadastrados). */
  emitenteId?: string | null;
}): Promise<{
  criados: number;
  ignorados: number;
  semVencimento: number;
  avisoBoleto?: string;
  nf?: { emitidas: number; rejeitadas: number; ignoradas: number; erros: string[] };
}> {
  const comp = params.competencia?.trim() || null;
  const ultimos = await fetchUltimoVencimentoMensalidadePorCliente(params.userId, params.clienteIds);
  const rows: MensalidadeInsertRow[] = [];

  let semVencimento = 0;
  let ignorados = 0;

  for (const clienteId of params.clienteIds) {
    const { data: c, error: e0 } = await supabase
      .from('clientes')
      .select('mensalidade, dia_vencimento, data_inicio, tipo_faturamento, parcelas_anuais')
      .eq('id', clienteId)
      .maybeSingle();

    let cli: {
      mensalidade: number | null;
      dia_vencimento: number | null;
      data_inicio: string | null;
      tipo_faturamento?: string | null;
      parcelas_anuais?: number | null;
    } | null = null;

    if (e0) {
      if (/tipo_faturamento|parcelas_anuais|dia_vencimento|column|schema cache/i.test(e0.message)) {
        const { data: c2, error: e2 } = await supabase
          .from('clientes')
          .select('mensalidade, dia_vencimento, data_inicio')
          .eq('id', clienteId)
          .maybeSingle();
        if (e2) {
          if (/dia_vencimento|column|schema cache/i.test(e2.message)) {
            const { data: c3, error: e3 } = await supabase
              .from('clientes')
              .select('mensalidade, data_inicio')
              .eq('id', clienteId)
              .maybeSingle();
            if (e3) throw new Error(e3.message);
            cli = {
              ...(c3 as { mensalidade: number | null; data_inicio: string | null }),
              dia_vencimento: null,
            };
          } else {
            throw new Error(e2.message);
          }
        } else {
          cli = c2 as typeof cli;
        }
      } else {
        throw new Error(e0.message);
      }
    } else {
      cli = c as typeof cli;
    }

    const valorTemporario = params.valoresPorCliente?.[clienteId];
    const valorMensal =
      valorTemporario != null && Number.isFinite(valorTemporario)
        ? valorTemporario
        : Number(cli?.mensalidade);
    if (!valorMensal || valorMensal <= 0) {
      ignorados += 1;
      continue;
    }

    const tipo = normalizeTipoFaturamento(cli?.tipo_faturamento);
    const parcelas = normalizeParcelasAnuais(cli?.parcelas_anuais) ?? 12;

    if (tipo === 'anual' && !params.dataVencimentoOverride) {
      const plano = montarParcelasAnuais({
        valorMensalidade: valorMensal,
        parcelas,
        diaVencimento: cli?.dia_vencimento ?? null,
        dataInicio: cli?.data_inicio ?? null,
        ultimoVencimento: ultimos.get(clienteId) ?? null,
      });
      if (!plano?.length) {
        semVencimento += 1;
        continue;
      }
      const loteId = newLoteId();
      for (const p of plano) {
        rows.push({
          user_id: params.userId,
          cliente_id: clienteId,
          valor: p.valor,
          valor_pago: 0,
          data_vencimento: p.data_vencimento,
          competencia: comp,
          status: 'pendente',
          lote_faturamento_id: loteId,
          parcela_numero: p.parcela_numero,
          parcela_total: p.parcela_total,
        });
      }
      continue;
    }

    let dataVenc: string;
    try {
      dataVenc = await resolverVencimentoMensalidadeCliente(params.userId, clienteId, {
        diaVencimento: cli?.dia_vencimento ?? null,
        dataInicio: cli?.data_inicio ?? null,
        ultimoVencimento: ultimos.get(clienteId) ?? null,
        override: params.dataVencimentoOverride ?? null,
      });
    } catch {
      semVencimento += 1;
      continue;
    }

    // Override de data única: se anual, ainda gera N parcelas com o valor anualizado,
    // mas a 1ª usa o override e as demais seguem o espaçamento a partir dela.
    if (tipo === 'anual') {
      const plano = montarParcelasAnuais({
        valorMensalidade: valorMensal,
        parcelas,
        diaVencimento: cli?.dia_vencimento ?? null,
        dataInicio: cli?.data_inicio ?? null,
        ultimoVencimento: null,
        hoje: dataVenc,
      });
      if (!plano?.length) {
        semVencimento += 1;
        continue;
      }
      const loteId = newLoteId();
      for (const p of plano) {
        rows.push({
          user_id: params.userId,
          cliente_id: clienteId,
          valor: p.valor,
          valor_pago: 0,
          data_vencimento: p.data_vencimento,
          competencia: comp,
          status: 'pendente',
          lote_faturamento_id: loteId,
          parcela_numero: p.parcela_numero,
          parcela_total: p.parcela_total,
        });
      }
      continue;
    }

    rows.push({
      user_id: params.userId,
      cliente_id: clienteId,
      valor: valorMensal,
      valor_pago: 0,
      data_vencimento: dataVenc,
      competencia: comp,
      status: 'pendente',
    });
  }
  if (!rows.length) {
    return { criados: 0, ignorados: params.clienteIds.length, semVencimento };
  }

  const { data: inserted, error } = await supabase
    .from('mensalidades')
    .insert(rows)
    .select('id, cliente_id, valor, data_vencimento, competencia');

  if (error) {
    if (/lote_faturamento_id|parcela_numero|column|schema cache/i.test(error.message)) {
      throw new Error(
        'Falta a migration do faturamento anual. Rode supabase/migrations/040_cliente_faturamento_anual.sql no SQL Editor.',
      );
    }
    throw new Error(error.message);
  }

  const criadosRows = (inserted ?? []) as {
    id: string;
    cliente_id: string;
    valor: number;
    data_vencimento: string;
    competencia: string | null;
  }[];

  let avisoBoleto: string | undefined;
  if (criadosRows.length) {
    try {
      const boletoRes = await gerarBoletosParaMensalidades(
        params.userId,
        criadosRows.map((m) => ({
          id: m.id,
          cliente_id: m.cliente_id,
          valor: m.valor,
          data_vencimento: m.data_vencimento,
          competencia: m.competencia,
        })),
      );
      avisoBoleto = boletoRes.avisoSicoob;
    } catch (eb) {
      const ids = criadosRows.map((m) => m.id);
      await supabase.from('mensalidades').delete().in('id', ids).eq('user_id', params.userId);
      throw new Error((eb as Error).message ?? 'Falha ao gerar carnês em contas a receber.');
    }
  }

  let nfResult;
  if (params.gerarNotaFiscal && criadosRows.length) {
    try {
      nfResult = await gerarNotasFiscaisParaMensalidades(
        params.userId,
        criadosRows.map((m) => ({
          id: m.id,
          cliente_id: m.cliente_id,
          valor: m.valor,
          competencia: m.competencia,
        })),
        { emitenteId: params.emitenteId },
      );
    } catch (e) {
      nfResult = {
        emitidas: 0,
        rejeitadas: criadosRows.length,
        ignoradas: 0,
        erros: [(e as Error).message],
      };
    }
  }

  return { criados: criadosRows.length, ignorados, semVencimento, avisoBoleto, nf: nfResult };
}

export async function registrarPagamentoMensalidadeGerada(
  userId: string,
  mensalidadeId: string,
  input: RegistrarPagamentoMensalidadeGeradaInput,
): Promise<void> {
  const payCent = cents(input.valor_pago);
  if (payCent <= 0) throw new Error('Informe um valor pago válido.');

  const { data: b, error: e0 } = await supabase
    .from('mensalidades')
    .select('*')
    .eq('id', mensalidadeId)
    .eq('user_id', userId)
    .single();
  if (e0 || !b) throw new Error(e0?.message ?? 'Mensalidade não encontrada.');
  const row = b as MensalidadeGerada;
  if (row.status === 'cancelado') throw new Error('Mensalidade cancelada.');
  if (row.status === 'pago' || cents(row.valor_pago) >= cents(row.valor)) throw new Error('Mensalidade já quitada.');

  const restanteCent = cents(row.valor) - cents(row.valor_pago);
  if (payCent > restanteCent) throw new Error('Valor pago ultrapassa o saldo em aberto da mensalidade.');

  const { error: e1 } = await supabase.from('pagamentos_mensalidades').insert({
    mensalidade_id: mensalidadeId,
    valor_pago: input.valor_pago,
    data_pagamento: input.data_pagamento,
    forma_pagamento: input.forma_pagamento.trim(),
    observacao: input.observacao.trim() || null,
    usuario_id: userId,
  });
  if (e1) throw new Error(e1.message);

  const novoPago = cents(row.valor_pago) + payCent;
  const novoPagoReais = novoPago / 100;
  const st = nextDbStatusAfterPay(row.valor, novoPagoReais);

  const { error: e2 } = await supabase
    .from('mensalidades')
    .update({
      valor_pago: novoPagoReais,
      data_pagamento: input.data_pagamento,
      forma_pagamento: input.forma_pagamento.trim(),
      observacao_pagamento: input.observacao.trim() || null,
      status: st,
    })
    .eq('id', mensalidadeId)
    .eq('user_id', userId);
  if (e2) throw new Error(e2.message);

  await supabase
    .from('boletos_parcela_venda')
    .update({ status_registro: 'pago', data_liquidacao_sicoob: input.data_pagamento })
    .eq('mensalidade_id', mensalidadeId)
    .eq('user_id', userId)
    .in('status_registro', ['registrado', 'pendente', 'informativo']);
}

export async function fetchResumoMensalidadesGeradasDashboard(userId: string): Promise<{
  valorPendenteMensalidadesGeradas: number;
  qtdMensalidadesGeradasAtrasadas: number;
}> {
  const { data, error } = await supabase
    .from('mensalidades')
    .select('valor, valor_pago, data_vencimento, status')
    .eq('user_id', userId)
    .neq('status', 'cancelado');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Pick<MensalidadeGerada, 'valor' | 'valor_pago' | 'data_vencimento' | 'status'>[];
  let valorPendenteMensalidadesGeradas = 0;
  let qtdMensalidadesGeradasAtrasadas = 0;
  const hoje = toISODate(new Date());
  for (const r of rows) {
    const open = Math.max(0, cents(r.valor) - cents(r.valor_pago)) / 100;
    valorPendenteMensalidadesGeradas += open;
    if (open > 0.001 && r.data_vencimento < hoje) qtdMensalidadesGeradasAtrasadas += 1;
  }
  return { valorPendenteMensalidadesGeradas, qtdMensalidadesGeradasAtrasadas };
}
