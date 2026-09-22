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

/** Mensalidade em aberto, sem pagamento — pode cancelar o mês (não vira pago). */
export function podeCancelarMensalidadeGerada(
  m: Pick<MensalidadeGerada, 'status' | 'valor' | 'valor_pago'>,
): boolean {
  if (m.status === 'cancelado' || m.status === 'pago') return false;
  if (cents(m.valor_pago) > 0) return false;
  return true;
}

function nextDbStatusAfterPay(valor: number, valorPagoNovo: number): MensalidadeGeradaStatusDb {
  const vc = cents(valor);
  const pc = cents(valorPagoNovo);
  if (pc >= vc) return 'pago';
  if (pc > 0) return 'parcial';
  return 'pendente';
}

export async function fetchMensalidadesGeradasHistorico(userId: string): Promise<MensalidadeGerada[]> {
  const mapRows = (
    data: (MensalidadeGerada & {
      clientes?: { nome_fantasia?: string; nome?: string; emitente_nf_id?: string | null } | null;
    })[],
  ): MensalidadeGerada[] =>
    data.map((row) => {
      const { clientes, ...rest } = row;
      return {
        ...rest,
        clientes: mapClienteJoinEmbed(clientes),
        cliente_emitente_nf_id: clientes?.emitente_nf_id ?? null,
      };
    });

  const withEmitente = await supabase
    .from('mensalidades')
    .select('*, clientes(nome_fantasia, nome, emitente_nf_id)')
    .eq('user_id', userId)
    .order('data_geracao', { ascending: false });

  if (!withEmitente.error) {
    return mapRows((withEmitente.data ?? []) as Parameters<typeof mapRows>[0]);
  }

  // Coluna emitente_nf_id ainda não existe (migration 048).
  if (/emitente_nf_id/i.test(withEmitente.error.message)) {
    const fallback = await supabase
      .from('mensalidades')
      .select('*, clientes(nome_fantasia, nome)')
      .eq('user_id', userId)
      .order('data_geracao', { ascending: false });
    if (fallback.error) throw new Error(fallback.error.message);
    return mapRows((fallback.data ?? []) as Parameters<typeof mapRows>[0]);
  }

  throw new Error(withEmitente.error.message);
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
): Promise<{ id: string; avisoBoleto?: string; avisoEmail?: string }> {
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
    const { avisoSicoob, avisoEmail } = await gerarBoletosParaMensalidades(userId, [
      {
        id: mensalidadeId,
        cliente_id: input.cliente_id,
        valor: input.valor,
        data_vencimento: dataVencimento,
        competencia: input.competencia ?? null,
      },
    ]);
    return { id: mensalidadeId, avisoBoleto: avisoSicoob, avisoEmail };
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
  /** CNPJ/emitente cobrador (boleto Sicoob ou C6) e NFS-e quando solicitada. */
  emitenteId?: string | null;
  /** Banco do boleto escolhido na geração (sobrescreve o padrão do emitente). */
  banco?: 'sicoob' | 'c6' | null;
  /** true (padrão) = CNPJ do cadastro do cliente; false = força emitenteId/banco para todos. */
  usarEmitenteDoCliente?: boolean;
  descricaoServico?: string | null;
  /**
   * 1º dia do mês (ISO) — agenda quando o cliente volta a aparecer em Gerar mensalidades.
   * Aplicado só aos clientes que tiveram ao menos uma mensalidade criada neste lote.
   */
  proximaGeracaoMes?: string | null;
}): Promise<{
  criados: number;
  ignorados: number;
  semVencimento: number;
  /** Já havia mensalidade em aberto com o mesmo vencimento (ou mesma competência). */
  duplicados: number;
  avisoBoleto?: string;
  avisoEmail?: string;
  nf?: { emitidas: number; rejeitadas: number; ignoradas: number; erros: string[] };
}> {
  const comp = params.competencia?.trim() || null;
  const ultimos = await fetchUltimoVencimentoMensalidadePorCliente(params.userId, params.clienteIds);
  const rows: MensalidadeInsertRow[] = [];

  let semVencimento = 0;
  let ignorados = 0;
  let duplicados = 0;

  /** Evita 2º carnê/boleto se o usuário regenerar após timeout (ex.: 504 no C6). */
  const existentesAbertos = new Map<string, { vencimentos: Set<string>; competencias: Set<string> }>();
  if (params.clienteIds.length) {
    const { data: jaTem, error: eDup } = await supabase
      .from('mensalidades')
      .select('cliente_id, data_vencimento, competencia, status')
      .eq('user_id', params.userId)
      .in('cliente_id', params.clienteIds)
      .neq('status', 'cancelado');
    if (eDup) throw new Error(eDup.message);
    for (const r of jaTem ?? []) {
      const cid = r.cliente_id as string;
      let bucket = existentesAbertos.get(cid);
      if (!bucket) {
        bucket = { vencimentos: new Set(), competencias: new Set() };
        existentesAbertos.set(cid, bucket);
      }
      const venc = String(r.data_vencimento ?? '').slice(0, 10);
      if (venc) bucket.vencimentos.add(venc);
      const c = (r.competencia as string | null)?.trim();
      if (c) bucket.competencias.add(c);
    }
  }

  const jaExisteCobranca = (clienteId: string, dataVenc: string): boolean => {
    const bucket = existentesAbertos.get(clienteId);
    if (!bucket) return false;
    if (bucket.vencimentos.has(dataVenc.slice(0, 10))) return true;
    if (comp && bucket.competencias.has(comp)) return true;
    return false;
  };

  const marcarComoExistente = (clienteId: string, dataVenc: string) => {
    let bucket = existentesAbertos.get(clienteId);
    if (!bucket) {
      bucket = { vencimentos: new Set(), competencias: new Set() };
      existentesAbertos.set(clienteId, bucket);
    }
    bucket.vencimentos.add(dataVenc.slice(0, 10));
    if (comp) bucket.competencias.add(comp);
  };

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
        if (jaExisteCobranca(clienteId, p.data_vencimento)) {
          duplicados += 1;
          continue;
        }
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
        marcarComoExistente(clienteId, p.data_vencimento);
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
        if (jaExisteCobranca(clienteId, p.data_vencimento)) {
          duplicados += 1;
          continue;
        }
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
        marcarComoExistente(clienteId, p.data_vencimento);
      }
      continue;
    }

    if (jaExisteCobranca(clienteId, dataVenc)) {
      duplicados += 1;
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
    marcarComoExistente(clienteId, dataVenc);
  }
  if (!rows.length) {
    return {
      criados: 0,
      ignorados,
      semVencimento,
      duplicados,
    };
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

  // Agenda próxima geração antes do registro bancário — se o C6 der timeout,
  // o cliente some da lista e um 2º clique não gera carnê/boleto de novo.
  const proxMes = params.proximaGeracaoMes?.trim().slice(0, 10) || null;
  if (proxMes && criadosRows.length) {
    const idsOk = [...new Set(criadosRows.map((m) => m.cliente_id))];
    const { error: eProx } = await supabase
      .from('clientes')
      .update({ proxima_geracao_mes: proxMes })
      .eq('user_id', params.userId)
      .in('id', idsOk);
    if (eProx) {
      if (/proxima_geracao_mes|column|schema cache/i.test(eProx.message)) {
        throw new Error(
          'Falta a migration da próxima geração. Rode supabase/migrations/042_cliente_proxima_geracao.sql no SQL Editor.',
        );
      }
      throw new Error(eProx.message);
    }
  }

  let avisoBoleto: string | undefined;
  let avisoEmail: string | undefined;
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
        { emitenteId: params.emitenteId, banco: params.banco, usarEmitenteDoCliente: params.usarEmitenteDoCliente },
      );
      avisoBoleto = boletoRes.avisoBoleto ?? boletoRes.avisoSicoob;
      avisoEmail = boletoRes.avisoEmail;
    } catch (eb) {
      // Não apaga mensalidades: o C6 pode ter registrado boletos órfãos no banco.
      // Mantém carnês para o usuário concluir com “Registrar no C6” / cancelar.
      avisoBoleto = (eb as Error).message ?? 'Falha ao gerar carnês em contas a receber.';
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
        {
          emitenteId: params.emitenteId,
          descricaoServico: params.descricaoServico,
          usarEmitenteDoCliente: params.usarEmitenteDoCliente,
        },
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

  return { criados: criadosRows.length, ignorados, semVencimento, duplicados, avisoBoleto, avisoEmail, nf: nfResult };
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

/**
 * Cancela o mês da mensalidade (status cancelado, não pago) e marca o carnê/boleto como baixado.
 * Se o boleto estiver registrado no banco (Sicoob/C6), baixa/cancela lá antes — senão não altera o sistema.
 */
export async function cancelarMensalidadeGerada(userId: string, mensalidadeId: string): Promise<void> {
  const { data: b, error: e0 } = await supabase
    .from('mensalidades')
    .select('*')
    .eq('id', mensalidadeId)
    .eq('user_id', userId)
    .single();
  if (e0 || !b) throw new Error(e0?.message ?? 'Mensalidade não encontrada.');
  const row = b as MensalidadeGerada;
  if (row.status === 'cancelado') throw new Error('Mensalidade já está cancelada.');
  if (row.status === 'pago' || cents(row.valor_pago) > 0) {
    throw new Error('Não é possível cancelar mensalidade com pagamento registrado. Estorne o pagamento antes.');
  }

  const { data: bols, error: eBol } = await supabase
    .from('boletos_parcela_venda')
    .select('id, status_registro, tipo_emissao, c6_boleto_id, nosso_numero_banco')
    .eq('mensalidade_id', mensalidadeId)
    .eq('user_id', userId);
  if (eBol) throw new Error(eBol.message);

  const paraBanco = ((bols ?? []) as {
    id: string;
    status_registro: string;
    tipo_emissao: string | null;
    c6_boleto_id: string | null;
    nosso_numero_banco: string | null;
  }[]).filter(
    (bol) =>
      bol.status_registro === 'registrado' ||
      Boolean(bol.c6_boleto_id) ||
      Boolean(bol.nosso_numero_banco),
  );

  if (paraBanco.length) {
    const { cancelarBoletosNoBanco } = await import('@/services/cancelarBoletoBancoService');
    const bancoRes = await cancelarBoletosNoBanco(paraBanco.map((x) => x.id));
    if (bancoRes.erros.length) {
      throw new Error(
        `Não foi possível cancelar no banco. O sistema não foi alterado.\n${bancoRes.erros.join('\n')}`,
      );
    }
  }

  const { error: e1 } = await supabase
    .from('mensalidades')
    .update({ status: 'cancelado' })
    .eq('id', mensalidadeId)
    .eq('user_id', userId);
  if (e1) throw new Error(e1.message);

  await supabase
    .from('boletos_parcela_venda')
    .update({ status_registro: 'baixado' })
    .eq('mensalidade_id', mensalidadeId)
    .eq('user_id', userId)
    .in('status_registro', ['registrado', 'pendente', 'informativo', 'erro']);

  if (bols?.length) {
    await supabase.from('historico_boleto_sicoob').insert(
      (bols as { id: string }[]).map((bol) => ({
        boleto_id: bol.id,
        acao: 'CANCELAMENTO_MANUAL',
        usuario_id: userId,
        detalhes: paraBanco.length
          ? 'Mensalidade cancelada no sistema após baixa/cancelamento no banco.'
          : 'Mensalidade cancelada no sistema (carnê sem registro bancário).',
        payload_resposta: null,
      })),
    );
  }
}

/** Reabre mensalidade cancelada só no sistema (boleto volta a em aberto / registrado). Não altera o banco. */
export async function reativarMensalidadeGerada(userId: string, mensalidadeId: string): Promise<void> {
  const { data: b, error: e0 } = await supabase
    .from('mensalidades')
    .select('*')
    .eq('id', mensalidadeId)
    .eq('user_id', userId)
    .single();
  if (e0 || !b) throw new Error(e0?.message ?? 'Mensalidade não encontrada.');
  const row = b as MensalidadeGerada;
  if (row.status !== 'cancelado') throw new Error('Mensalidade não está cancelada.');
  if (cents(row.valor_pago) > 0) {
    throw new Error('Mensalidade tem pagamento — não reative por este fluxo.');
  }

  const { error: e1 } = await supabase
    .from('mensalidades')
    .update({ status: 'pendente' })
    .eq('id', mensalidadeId)
    .eq('user_id', userId);
  if (e1) throw new Error(e1.message);

  const { data: bols } = await supabase
    .from('boletos_parcela_venda')
    .select('id, linha_digitavel, pdf_url, nosso_numero_banco, c6_boleto_id, tipo_emissao')
    .eq('mensalidade_id', mensalidadeId)
    .eq('user_id', userId);

  for (const bol of (bols ?? []) as {
    id: string;
    linha_digitavel: string | null;
    pdf_url: string | null;
    nosso_numero_banco: string | null;
    c6_boleto_id: string | null;
    tipo_emissao: string | null;
  }[]) {
    const registrado =
      Boolean(bol.linha_digitavel || bol.pdf_url || bol.nosso_numero_banco || bol.c6_boleto_id) &&
      (bol.tipo_emissao === 'sicoob' || bol.tipo_emissao === 'c6');
    await supabase
      .from('boletos_parcela_venda')
      .update({ status_registro: registrado ? 'registrado' : 'pendente' })
      .eq('id', bol.id)
      .eq('user_id', userId);

    await supabase.from('historico_boleto_sicoob').insert({
      boleto_id: bol.id,
      acao: 'REATIVACAO_MANUAL',
      usuario_id: userId,
      detalhes: 'Cobrança reaberta no sistema (boleto permanece ativo no banco se não foi baixado lá).',
      payload_resposta: null,
    });
  }
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
