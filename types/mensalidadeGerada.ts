/** Status persistido na tabela `public.mensalidades`. */
export type MensalidadeGeradaStatusDb = 'pendente' | 'parcial' | 'pago' | 'atrasado' | 'cancelado';

/** Status para UI (atrasado derivado de vencimento quando ainda há saldo). */
export type MensalidadeGeradaStatusVisual = MensalidadeGeradaStatusDb;

/** Uma linha da tabela `public.mensalidades` (geração de cobrança de mensalidade). */
export interface MensalidadeGerada {
  id: string;
  user_id: string;
  cliente_id: string;
  valor: number;
  valor_pago: number;
  data_vencimento: string;
  competencia: string | null;
  status: MensalidadeGeradaStatusDb;
  data_geracao: string;
  observacao: string | null;
  data_pagamento: string | null;
  forma_pagamento: string | null;
  observacao_pagamento: string | null;
  created_at: string;
  updated_at?: string;
  /** Agrupa parcelas do faturamento anual geradas juntas. */
  lote_faturamento_id?: string | null;
  parcela_numero?: number | null;
  parcela_total?: number | null;
  clientes?: { nome_cliente: string; nome_empresa: string | null } | null;
}

export interface PagamentoMensalidadeGerada {
  id: string;
  mensalidade_id: string;
  valor_pago: number;
  data_pagamento: string;
  forma_pagamento: string;
  observacao: string | null;
  usuario_id: string;
  created_at: string;
}

export interface RegistrarPagamentoMensalidadeGeradaInput {
  data_pagamento: string;
  valor_pago: number;
  forma_pagamento: string;
  observacao: string;
}

export interface CriarMensalidadeGeradaInput {
  cliente_id: string;
  valor: number;
  /** Opcional: calcula a partir do dia de vencimento do cadastro (próximo dia N). */
  data_vencimento?: string | null;
  competencia?: string | null;
  observacao?: string | null;
}
