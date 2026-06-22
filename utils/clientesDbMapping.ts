import type { Cliente, ClienteFormValues, ClienteListItem, SortField } from '@/types/models';
import { parseBRLMasked } from '@/utils/currency';
import { toISODate } from '@/utils/date';

/** Linha bruta de public.clientes (schema legado + colunas adicionadas pelo app). */
export type ClienteDbRow = {
  id: number | string;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string | null;
  nome?: string | null;
  nome_fantasia?: string | null;
  cnpj?: string | null;
  mensalidade?: number | null;
  data_inicio?: string | null;
  data_reajuste?: string | null;
  ultimo_reajuste?: string | null;
  data_cancelamento?: string | null;
  ativo?: string | null;
  tipo_cliente?: string | null;
  cidade?: string | null;
  estado?: string | null;
  celular?: string | null;
  email?: string | null;
  documento?: string | null;
  mes_entrada?: string | null;
  observacao?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  segmento_cliente_codigo?: string | null;
  valor_mensalidade_anterior?: number | null;
  emite_nf?: boolean | null;
  inscricao_estadual?: string | null;
  pdf_path?: string | null;
  cancelado?: boolean | null;
};

export const CLIENTE_LIST_SELECT =
  'id, user_id, created_at, updated_at, documento, cnpj, nome, nome_fantasia, mensalidade, data_inicio, data_reajuste, ultimo_reajuste, mes_entrada, observacao, cep, logradouro, numero, complemento, bairro, cidade, estado, segmento_cliente_codigo, tipo_cliente, valor_mensalidade_anterior, emite_nf, inscricao_estadual, pdf_path, cancelado, ativo, data_cancelamento, celular, email';

export const CLIENTE_DETAIL_SELECT = `${CLIENTE_LIST_SELECT}, contatos_cliente(*)`;

export const CLIENTE_GERAR_MENSALIDADES_SELECT =
  'id, nome, nome_fantasia, mensalidade, valor_mensalidade_anterior, segmento_cliente_codigo, tipo_cliente, cancelado, ativo, data_cancelamento, data_reajuste, data_inicio';

/** Join embutido em outras tabelas (mensalidades, vendas, NF). */
export const CLIENTE_EMBED_SELECT = 'nome_fantasia, nome, cnpj, documento, emite_nf, logradouro, numero, bairro, cidade, estado, cep';

export const SORT_FIELD_DB: Record<SortField, string> = {
  nome_cliente: 'nome_fantasia',
  valor_mensalidade: 'mensalidade',
  created_at: 'created_at',
  segmento_cliente_codigo: 'segmento_cliente_codigo',
};

export function isClienteCancelado(row: Pick<ClienteDbRow, 'cancelado' | 'ativo' | 'data_cancelamento'>): boolean {
  if (row.cancelado === true) return true;
  if (row.cancelado === false) return false;
  if (row.data_cancelamento) return true;
  const a = (row.ativo ?? 'S').trim().toUpperCase();
  return a !== '' && a !== 'S';
}

export function mapDbRowToCliente(row: ClienteDbRow): Cliente {
  const segmento = (row.segmento_cliente_codigo ?? 'DIVERSOS').trim() || 'DIVERSOS';
  return {
    id: String(row.id),
    user_id: row.user_id ?? '',
    documento: (row.documento ?? '').trim(),
    cnpj: row.cnpj ?? undefined,
    nome_cliente: (row.nome_fantasia ?? row.nome ?? '').trim(),
    nome_empresa: row.nome?.trim() || null,
    mes_entrada: row.mes_entrada ?? null,
    valor_mensalidade: row.mensalidade == null ? null : Number(row.mensalidade),
    valor_mensalidade_anterior:
      row.valor_mensalidade_anterior == null ? null : Number(row.valor_mensalidade_anterior),
    segmento_cliente_codigo: segmento,
    tipo_ramo: null,
    data_inicio: row.data_inicio ?? null,
    data_reajuste: row.data_reajuste ?? null,
    ultimo_reajuste: row.ultimo_reajuste ?? null,
    observacao: row.observacao ?? null,
    cep: row.cep ?? null,
    logradouro: row.logradouro ?? null,
    numero: row.numero ?? null,
    complemento: row.complemento ?? null,
    bairro: row.bairro ?? null,
    cidade: row.cidade ?? null,
    uf: row.estado ?? null,
    pdf_path: row.pdf_path ?? null,
    cancelado: isClienteCancelado(row),
    emite_nf: Boolean(row.emite_nf),
    inscricao_estadual: row.inscricao_estadual ?? undefined,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? undefined,
  };
}

export function mapDbRowToClienteListItem(row: ClienteDbRow): ClienteListItem {
  return mapDbRowToCliente(row);
}

export function mapClienteJoinEmbed(
  row: { nome_fantasia?: string | null; nome?: string | null } | null | undefined,
): { nome_cliente: string; nome_empresa: string | null } | null {
  if (!row) return null;
  return {
    nome_cliente: (row.nome_fantasia ?? row.nome ?? '').trim() || '—',
    nome_empresa: row.nome?.trim() || null,
  };
}

export function mapClienteFormToDbRow(
  values: ClienteFormValues,
  documento: string,
  extras?: {
    pdf_path?: string | null;
    ultimo_reajuste?: string | null;
    valor_mensalidade_anterior?: number | null;
    user_id?: string;
  },
): Record<string, unknown> {
  const valor = parseBRLMasked(values.valor_mensalidade);
  if (valor == null) throw new Error('Valor inválido');
  const codigo = values.segmento_cliente_codigo.trim();
  if (!codigo) throw new Error('Selecione o segmento do cliente.');

  const cancelado = values.cancelado;

  return {
    ...(extras?.user_id ? { user_id: extras.user_id } : {}),
    documento,
    cnpj: values.cnpj.trim() || null,
    nome: values.nome_empresa.trim() || null,
    nome_fantasia: values.nome_cliente.trim(),
    mensalidade: valor,
    segmento_cliente_codigo: codigo,
    tipo_cliente: codigo,
    data_inicio: values.data_inicio ? toISODate(values.data_inicio) : null,
    data_reajuste: values.data_reajuste ? toISODate(values.data_reajuste) : null,
    mes_entrada: values.mes_entrada.trim() || null,
    observacao: values.observacao.trim() || null,
    cep: values.cep.trim() || null,
    logradouro: values.logradouro.trim() || null,
    numero: values.numero.trim() || null,
    complemento: values.complemento.trim() || null,
    bairro: values.bairro.trim() || null,
    cidade: values.cidade.trim() || null,
    estado: values.uf.trim() ? values.uf.trim().toUpperCase().slice(0, 2) : null,
    inscricao_estadual: values.inscricao_estadual.trim() || '',
    cancelado,
    ativo: cancelado ? 'N' : 'S',
    data_cancelamento: cancelado ? toISODate(new Date()) : null,
    emite_nf: values.emite_nf,
    pdf_path: extras?.pdf_path ?? null,
    ultimo_reajuste: extras?.ultimo_reajuste ?? null,
    valor_mensalidade_anterior: extras?.valor_mensalidade_anterior ?? null,
  };
}

/** Campos usados em boletos / NFS-e a partir da linha bruta. */
export function mapClienteEnderecoFiscal(row: ClienteDbRow): {
  documento: string;
  cnpj?: string | null;
  nome_cliente: string;
  nome_empresa: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  emite_nf: boolean;
} {
  const c = mapDbRowToCliente(row);
  return {
    documento: c.documento,
    cnpj: c.cnpj,
    nome_cliente: c.nome_cliente,
    nome_empresa: c.nome_empresa,
    cep: c.cep,
    logradouro: c.logradouro,
    numero: c.numero,
    complemento: c.complemento,
    bairro: c.bairro,
    cidade: c.cidade,
    uf: c.uf,
    emite_nf: Boolean(c.emite_nf),
  };
}
