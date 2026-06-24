import { supabase } from '@/lib/supabase';
import { removeClientePdf, uploadClientePdf } from '@/services/clientePdfStorage';
import type {
  Cliente,
  ClienteFormValues,
  ClienteListItem,
  ContatoCliente,
  ContatoClienteInput,
  SortField,
  SortOrder,
} from '@/types/models';
import { getSegmentoNomePorCodigo } from '@/services/segmentoClienteService';
import { parseBRLMasked } from '@/utils/currency';
import { toISODate } from '@/utils/date';
import {
  CLIENTE_DETAIL_SELECT,
  CLIENTE_GERAR_MENSALIDADES_SELECT,
  CLIENTE_LIST_SELECT,
  isClienteCancelado,
  mapClienteFormToDbRow,
  mapDbRowToCliente,
  mapDbRowToClienteListItem,
  SORT_FIELD_DB,
  type ClienteDbRow,
} from '@/utils/clientesDbMapping';

export const PAGE_SIZE = 20;

export type ClienteSituacaoFiltro = 'todos' | 'ativos' | 'cancelados';

function mapClienteDbError(message: string, code?: string): string {
  if (code === '23505' || message.includes('duplicate') || message.includes('unique')) {
    if (message.includes('cnpj') || message.includes('ux_clientes_user_cnpj')) {
      return 'Este CNPJ já está cadastrado para outro cliente.';
    }
    return 'Este número de documento já está em uso. Escolha outro.';
  }
  return message;
}

async function resolveDocumento(
  userId: string,
  raw: string,
  opts: { mode: 'create' } | { mode: 'update'; previousDocumento: string },
): Promise<string> {
  const trimmed = raw.trim();
  if (trimmed) return trimmed;
  if (opts.mode === 'update' && opts.previousDocumento.trim()) {
    return opts.previousDocumento.trim();
  }
  const { data, error } = await supabase.rpc('alloc_zpf_documento', { p_user_id: userId });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || !data) {
    throw new Error('Não foi possível gerar o documento automático (ZPF). Rode a migration 006 no Supabase.');
  }
  return data;
}


function mapContatoCount(row: unknown): number {
  const r = row as { contatos_cliente?: { count?: number }[] };
  const arr = r.contatos_cliente;
  if (Array.isArray(arr) && arr[0] && typeof arr[0].count === 'number') {
    return arr[0].count;
  }
  return 0;
}

async function fetchUltimaJustificativaCancelamentoCliente(clienteId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('justificativas_cancelamento_cliente')
    .select('texto')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  const first = (data as { texto: string }[] | null)?.[0];
  const t = first?.texto?.trim();
  return t || null;
}

async function insertJustificativaCancelamentoCliente(
  userId: string,
  clienteId: string,
  texto: string,
): Promise<void> {
  const t = texto.trim();
  if (!t) throw new Error('Justificativa do cancelamento é obrigatória.');
  const { error } = await supabase.from('justificativas_cancelamento_cliente').insert({
    cliente_id: clienteId,
    user_id: userId,
    texto: t,
  });
  if (error) throw new Error(error.message);
}

function enrichClienteSegmento<T extends { segmento_cliente_codigo?: string }>(
  row: T,
  nomePorCodigo: Map<string, string>,
): T & { segmento_cliente?: { codigo: string; nome: string } } {
  const codigo = row.segmento_cliente_codigo?.trim();
  if (!codigo) return { ...row, segmento_cliente: undefined };
  const nome = nomePorCodigo.get(codigo) ?? codigo;
  return { ...row, segmento_cliente: { codigo, nome } };
}

const LIST_SELECT = `${CLIENTE_LIST_SELECT}, contatos_cliente(count)`;
const DETAIL_SELECT = CLIENTE_DETAIL_SELECT;

export async function fetchClientsPage(params: {
  userId: string;
  search: string;
  sortField: SortField;
  sortOrder: SortOrder;
  page: number;
  situacao?: ClienteSituacaoFiltro;
}): Promise<{ items: ClienteListItem[]; hasMore: boolean }> {
  const from = params.page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from('clientes')
    .select(LIST_SELECT, { count: 'exact' })
    .order(SORT_FIELD_DB[params.sortField], { ascending: params.sortOrder === 'asc' })
    .range(from, to);

  const situacao = params.situacao ?? 'todos';
  if (situacao === 'ativos') {
    q = q.eq('cancelado', false);
  } else if (situacao === 'cancelados') {
    q = q.eq('cancelado', true);
  }

  const term = params.search.trim().replace(/[%_,()]/g, '');
  if (term) {
    const esc = term.replace(/%/g, '\\%').replace(/,/g, '');
    q = q.or(
      `nome_fantasia.ilike.%${esc}%,nome.ilike.%${esc}%,documento.ilike.%${esc}%,cnpj.ilike.%${esc}%,cep.ilike.%${esc}%,cidade.ilike.%${esc}%,segmento_cliente_codigo.ilike.%${esc}%,tipo_cliente.ilike.%${esc}%`,
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as (ClienteDbRow & {
    contatos_cliente?: { count: number }[];
  })[];

  const nomeMap = await getSegmentoNomePorCodigo();
  const items: ClienteListItem[] = rows.map((row) => ({
    ...enrichClienteSegmento(mapDbRowToClienteListItem(row), nomeMap),
    contatos_count: mapContatoCount(row),
  }));

  const hasMore = rows.length === PAGE_SIZE;
  return { items, hasMore };
}

/** Carrega todas as páginas para exportação (limite de segurança: 100 páginas). */
export async function fetchClientsExportAll(params: {
  userId: string;
  search: string;
  sortField: SortField;
  sortOrder: SortOrder;
  situacao?: ClienteSituacaoFiltro;
}): Promise<ClienteListItem[]> {
  const all: ClienteListItem[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore && page < 100) {
    const { items, hasMore: more } = await fetchClientsPage({ ...params, page });
    all.push(...items);
    hasMore = more;
    page += 1;
  }
  return all;
}

export async function fetchClienteDetail(
  userId: string,
  id: string,
): Promise<(Cliente & { contatos_cliente: ContatoCliente[] }) | null> {
  const { data, error } = await supabase
    .from('clientes')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as ClienteDbRow & { contatos_cliente: ContatoCliente[] | null };
  const contatos = [...(row.contatos_cliente ?? [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const nomeMap = await getSegmentoNomePorCodigo();
  const base = enrichClienteSegmento(mapDbRowToCliente(row), nomeMap);
  const ultima_justificativa_cancelamento = await fetchUltimaJustificativaCancelamentoCliente(id);
  return { ...base, contatos_cliente: contatos, ultima_justificativa_cancelamento };
}

export async function createCliente(
  userId: string,
  values: ClienteFormValues,
): Promise<{ id: string }> {
  const documento = await resolveDocumento(userId, values.documento, { mode: 'create' });

  if (values.cancelado && !values.cancelamento_justificativa.trim()) {
    throw new Error('Informe a justificativa do cancelamento.');
  }

  const row = mapClienteFormToDbRow(values, documento, {
    user_id: userId,
    pdf_path: null,
    ultimo_reajuste: null,
    valor_mensalidade_anterior: null,
  });

  const { data: inserted, error } = await supabase
    .from('clientes')
    .insert(row)
    .select('id')
    .single();

  if (error) throw new Error(mapClienteDbError(error.message, error.code));
  const clienteId = inserted.id as string;

  const contatos = values.contatos
    .filter((c) => c.nome_contato.trim() && c.valor_contato.trim())
    .map((c) => ({
      cliente_id: clienteId,
      nome_contato: c.nome_contato.trim(),
      tipo_contato: c.tipo_contato,
      valor_contato: c.valor_contato.trim(),
    }));

  if (contatos.length) {
    const { error: e2 } = await supabase.from('contatos_cliente').insert(contatos);
    if (e2) throw new Error(e2.message);
  }

  if (values.cancelado) {
    await insertJustificativaCancelamentoCliente(
      userId,
      clienteId,
      values.cancelamento_justificativa,
    );
  }

  if (values.pdfLocalUri && values.pdfFileName) {
    const path = await uploadClientePdf({
      userId,
      clienteId,
      localUri: values.pdfLocalUri,
      originalFileName: values.pdfFileName,
    });
    const { error: e3 } = await supabase
      .from('clientes')
      .update({ pdf_path: path })
      .eq('id', clienteId);
    if (e3) throw new Error(e3.message);
  }

  return { id: clienteId };
}

export async function updateCliente(
  userId: string,
  clienteId: string,
  values: ClienteFormValues,
): Promise<void> {
  const { data: cur, error: e0 } = await supabase
    .from('clientes')
    .select('pdf_path, data_reajuste, ultimo_reajuste, documento, mensalidade, cancelado, ativo, data_cancelamento')
    .eq('id', clienteId)
    .maybeSingle();

  if (e0) throw new Error(e0.message);
  type CurRow = {
    pdf_path: string | null;
    data_reajuste: string | null;
    ultimo_reajuste: string | null;
    documento: string;
    mensalidade: number | null;
    cancelado: boolean | null;
    ativo: string | null;
    data_cancelamento: string | null;
  };
  const curRow = cur as CurRow | null;
  if (!curRow) throw new Error('Cliente não encontrado.');
  const wasCanceled = isClienteCancelado(curRow);
  const becomingCanceled = values.cancelado && !wasCanceled;
  if (values.cancelado && !values.cancelamento_justificativa.trim()) {
    throw new Error('Informe a justificativa do cancelamento.');
  }
  const oldPdf = curRow.pdf_path ?? null;
  const oldDataReajuste = curRow.data_reajuste ?? null;
  const curUltimoReajuste = curRow.ultimo_reajuste ?? null;

  let nextPdf: string | null = oldPdf;

  if (values.pdfLocalUri && values.pdfFileName) {
    const path = await uploadClientePdf({
      userId,
      clienteId,
      localUri: values.pdfLocalUri,
      originalFileName: values.pdfFileName,
    });
    if (oldPdf && oldPdf !== path) {
      await removeClientePdf(oldPdf);
    }
    nextPdf = path;
  } else if (!values.pdfPath && oldPdf) {
    await removeClientePdf(oldPdf);
    nextPdf = null;
  } else if (values.pdfPath) {
    nextPdf = values.pdfPath;
  }

  const newDataReajuste = values.data_reajuste ? toISODate(values.data_reajuste) : null;
  let nextUltimoReajuste = curUltimoReajuste;
  if (oldDataReajuste !== newDataReajuste) {
    if (oldDataReajuste != null) {
      nextUltimoReajuste = oldDataReajuste;
    }
  }

  const documento = await resolveDocumento(userId, values.documento, {
    mode: 'update',
    previousDocumento: curRow.documento,
  });

  const novoValor = parseBRLMasked(values.valor_mensalidade);
  if (novoValor == null) throw new Error('Valor inválido');
  const oldVal = curRow.mensalidade == null ? null : Number(curRow.mensalidade);
  const valorMudou =
    oldVal == null
      ? true
      : Math.round(oldVal * 100) !== Math.round(novoValor * 100);

  const row = mapClienteFormToDbRow(values, documento, {
    pdf_path: nextPdf,
    ultimo_reajuste: nextUltimoReajuste,
    ...(valorMudou && oldVal != null ? { valor_mensalidade_anterior: oldVal } : {}),
  });

  const { error } = await supabase
    .from('clientes')
    .update(row)
    .eq('id', clienteId);

  if (error) throw new Error(mapClienteDbError(error.message, error.code));

  const { error: delErr } = await supabase
    .from('contatos_cliente')
    .delete()
    .eq('cliente_id', clienteId);

  if (delErr) throw new Error(delErr.message);

  const contatos: ContatoClienteInput[] = values.contatos
    .filter((c) => c.nome_contato.trim() && c.valor_contato.trim())
    .map((c) => ({
      nome_contato: c.nome_contato.trim(),
      tipo_contato: c.tipo_contato,
      valor_contato: c.valor_contato.trim(),
    }));

  if (contatos.length) {
    const { error: insErr } = await supabase.from('contatos_cliente').insert(
      contatos.map((c) => ({
        cliente_id: clienteId,
        nome_contato: c.nome_contato,
        tipo_contato: c.tipo_contato,
        valor_contato: c.valor_contato,
      })),
    );
    if (insErr) throw new Error(insErr.message);
  }

  if (values.cancelado) {
    const texto = values.cancelamento_justificativa.trim();
    const ultima = await fetchUltimaJustificativaCancelamentoCliente(clienteId);
    if (becomingCanceled || texto !== (ultima ?? '').trim()) {
      await insertJustificativaCancelamentoCliente(userId, clienteId, texto);
    }
  }
}

export async function setClienteCancelado(
  userId: string,
  clienteId: string,
  cancelado: boolean,
  justificativa?: string,
): Promise<void> {
  if (cancelado) {
    await insertJustificativaCancelamentoCliente(userId, clienteId, justificativa ?? '');
  }
  const { error } = await supabase
    .from('clientes')
    .update({
      cancelado,
      ativo: cancelado ? 'N' : 'S',
      data_cancelamento: cancelado ? toISODate(new Date()) : null,
    })
    .eq('id', clienteId);
  if (error) throw new Error(error.message);
}

export async function deleteCliente(userId: string, clienteId: string): Promise<void> {
  const { data: cur, error: e0 } = await supabase
    .from('clientes')
    .select('pdf_path')
    .eq('id', clienteId)
    .maybeSingle();

  if (e0) throw new Error(e0.message);
  const pdfPath = (cur as { pdf_path: string | null } | null)?.pdf_path ?? null;

  const { error } = await supabase
    .from('clientes')
    .delete()
    .eq('id', clienteId);

  if (error) throw new Error(error.message);

  if (pdfPath) {
    await removeClientePdf(pdfPath);
  }
}

export async function fetchDashboardStats(userId: string): Promise<{
  totalClientes: number;
  somaMensalidades: number;
}> {
  const { data, error } = await supabase
    .from('clientes')
    .select('mensalidade, cancelado, ativo, data_cancelamento');

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Pick<ClienteDbRow, 'mensalidade' | 'cancelado' | 'ativo' | 'data_cancelamento'>[];
  const active = rows.filter((r) => !isClienteCancelado(r));
  const totalClientes = active.length;
  const somaMensalidades = active.reduce((acc, r) => acc + (Number(r.mensalidade) || 0), 0);
  return { totalClientes, somaMensalidades };
}

export type GerarMensalidadeFiltrosClientes = {
  search: string;
  segmentoCodigo: string | 'todos';
  incluirCancelados: boolean;
  /**
   * Quando informado, retorna clientes cuja `data_reajuste` cai no mês (inclusive entre de e ate).
   * Ex.: reajuste em junho/2026 → de 2026-06-01, ate 2026-06-30.
   */
  mesReajusteDe: string | null;
  mesReajusteAte: string | null;
};

const GERAR_MENSALIDADES_CLIENTES_SELECT = CLIENTE_GERAR_MENSALIDADES_SELECT;

export async function fetchClientesParaGerarMensalidades(
  userId: string,
  filters: GerarMensalidadeFiltrosClientes,
): Promise<ClienteListItem[]> {
  let q = supabase
    .from('clientes')
    .select(GERAR_MENSALIDADES_CLIENTES_SELECT)
    .order('nome_fantasia', { ascending: true })
    .limit(800);

  if (!filters.incluirCancelados) {
    q = q.eq('cancelado', false);
  }
  if (filters.segmentoCodigo !== 'todos') {
    q = q.eq('segmento_cliente_codigo', filters.segmentoCodigo);
  }
  const term = filters.search.trim().replace(/[%_,()]/g, '');
  if (term) {
    const esc = term.replace(/%/g, '\\%').replace(/,/g, '');
    q = q.or(`nome_fantasia.ilike.%${esc}%,nome.ilike.%${esc}%,documento.ilike.%${esc}%,cnpj.ilike.%${esc}%`);
  }
  if (filters.mesReajusteDe && filters.mesReajusteAte) {
    q = q
      .not('data_reajuste', 'is', null)
      .gte('data_reajuste', filters.mesReajusteDe)
      .lte('data_reajuste', filters.mesReajusteAte);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ClienteDbRow[];
  const nomeMap = await getSegmentoNomePorCodigo();
  return rows.map((row) => enrichClienteSegmento(mapDbRowToClienteListItem(row), nomeMap));
}

export async function applyReajusteMensalidadePercentual(
  userId: string,
  clienteIds: string[],
  percent: number,
): Promise<void> {
  if (!clienteIds.length) {
    throw new Error('Selecione ao menos um cliente ou use “Todos na lista”.');
  }
  if (!Number.isFinite(percent) || percent === 0) {
    throw new Error('Informe um percentual de reajuste diferente de zero (ex.: 5 para +5%).');
  }
  const factor = 1 + percent / 100;

  for (const clienteId of clienteIds) {
    const { data: cur, error: e0 } = await supabase
      .from('clientes')
      .select('mensalidade')
      .eq('id', clienteId)
      .maybeSingle();
    if (e0) throw new Error(e0.message);
    const old = Number((cur as { mensalidade: number | null } | null)?.mensalidade);
    if (old == null || Number.isNaN(old) || old <= 0) continue;
    const novo = Math.round(old * factor * 100) / 100;
    const { error: e1 } = await supabase
      .from('clientes')
      .update({
        valor_mensalidade_anterior: old,
        mensalidade: novo,
      })
      .eq('id', clienteId);
    if (e1) throw new Error(e1.message);
  }
}

export { getClientePdfSignedUrl } from '@/services/clientePdfStorage';
