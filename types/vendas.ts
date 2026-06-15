export type VendaStatus = 'pendente' | 'parcial' | 'quitada' | 'cancelada';

export type ParcelaVendaStatus = 'pendente' | 'pago' | 'parcial' | 'atrasado' | 'cancelado';

export interface FormaPagamento {
  id: string;
  nome: string;
  ativo: boolean;
  created_at: string;
}

export interface Venda {
  id: string;
  user_id: string;
  cliente_id: string;
  descricao: string;
  /** JSON no banco: 2+ itens; ausente/null = descrição única em `descricao`. */
  itens_descricao?: string[] | null;
  valor_total: number;
  status: VendaStatus;
  created_at: string;
  updated_at?: string;
}

export interface VendaListRow extends Venda {
  cliente?: { nome_cliente: string; nome_empresa: string | null } | null;
  qtd_parcelas?: number;
  valor_pago_sum?: number;
  valor_pendente?: number;
}

export interface ParcelaVenda {
  id: string;
  venda_id: string;
  grupo_index: number;
  numero_parcela: number;
  valor: number;
  valor_pago: number;
  data_vencimento: string;
  status: ParcelaVendaStatus;
  forma_pagamento_id: string;
  created_at: string;
  forma_pagamento?: { id: string; nome: string } | null;
}

export interface PagamentoVenda {
  id: string;
  venda_id: string;
  user_id: string;
  data_pagamento: string;
  valor_pago: number;
  observacao: string | null;
  created_at: string;
}

export interface PagamentoParcelaRow {
  id: string;
  pagamento_id: string;
  parcela_id: string;
  valor_aplicado: number;
}

export interface VendaDetail extends Venda {
  cliente: { id: string; nome_cliente: string; nome_empresa: string | null };
  parcelas: ParcelaVenda[];
  pagamentos: PagamentoVenda[];
  pagamento_parcelas: PagamentoParcelaRow[];
}

export interface NovaVendaParcelaInput {
  grupo_index: number;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  forma_pagamento_id: string;
}

export interface NovaVendaInput {
  cliente_id: string;
  /** Uma ou mais linhas de descrição (strings por item). */
  descricao_itens: string[];
  valor_total: number;
  parcelas: NovaVendaParcelaInput[];
}

export interface VendaListFilters {
  search: string;
  status: VendaStatus | 'todos';
  formaPagamentoId: string | 'todos';
  /** Data de criação da venda (ISO yyyy-mm-dd). */
  dataDe: string | null;
  dataAte: string | null;
  /** Parcela com `data_vencimento` no intervalo (qualquer parcela da venda). */
  vencimentoDe: string | null;
  vencimentoAte: string | null;
  /** `pagamentos_venda.data_pagamento` no intervalo (qualquer pagamento da venda). */
  pagamentoDe: string | null;
  pagamentoAte: string | null;
  clienteId: string | 'todos';
}

export interface VendaFinanceiroStats {
  totalVendido: number;
  totalRecebido: number;
  totalPendente: number;
  parcelasAtrasadas: number;
  vendasAbertas: number;
}

export interface RegistrarPagamentoInput {
  data_pagamento: string;
  valor_pago: number;
  observacao: string;
  alocacao_manual?: { parcela_id: string; valor: number }[];
}
