export type AzoupStatusGrupo = 'ativa' | 'trial' | 'inadimplente' | 'cancelada' | 'outro';

export type AzoupPlanoResumo = {
  plano_id: string;
  nome: string;
  ativos: number;
  inativos: number;
  total: number;
};

export type AzoupEnderecoResumo = {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

export type AzoupClienteResumo = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  created_at: string | null;
  plano_nome: string | null;
  status_grupo: AzoupStatusGrupo;
  status_label: string;
  /** MRR líquido (após cupom), em centavos. */
  valor_centavos: number;
  /** Valor cheio (antes do cupom), em centavos. */
  valor_bruto_centavos: number;
  desconto_centavos: number;
  empresa_matriz_nome: string | null;
  empresa_matriz_cnpj: string | null;
  pode_emitir_nf: boolean;
  endereco?: AzoupEnderecoResumo;
};

export type AzoupClienteNfPayload = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa_matriz_nome: string | null;
  empresa_matriz_razao: string | null;
  empresa_matriz_cnpj: string | null;
  endereco: AzoupEnderecoResumo;
  plano_id: string | null;
  status_grupo: AzoupStatusGrupo;
  status_label: string;
  valor_centavos: number;
  valor_bruto_centavos: number;
};

export type AzoupDashboardData = {
  gerado_em: string;
  mrr_fonte: 'stripe' | 'local';
  total_clientes: number;
  clientes_assinatura_ativa: number;
  clientes_trial: number;
  clientes_inadimplentes: number;
  clientes_cancelados: number;
  /** MRR líquido (após cupons). */
  mrr_centavos: number;
  /** MRR valor cheio (antes dos cupons). */
  mrr_bruto_centavos: number;
  desconto_centavos: number;
  assinaturas_com_desconto: number;
  planos_clientes: AzoupPlanoResumo[];
  clientes: AzoupClienteResumo[];
};

export type AzoupFaturaResumo = {
  id: string;
  stripe_invoice_id: string;
  numero: string | null;
  azoup_cliente_id: string | null;
  cliente_nome: string;
  cliente_email: string | null;
  empresa_matriz_nome: string | null;
  empresa_matriz_cnpj: string | null;
  pode_emitir_nf: boolean;
  valor_centavos: number;
  status: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  data_pagamento: string | null;
  criado_em: string | null;
  vencimento?: string | null;
  competencia: string | null;
  frequencia: string;
  endereco?: AzoupEnderecoResumo;
  fonte: 'stripe' | 'historico';
  /** NFS-e já emitida para esta fatura Stripe. */
  nfse_emitida?: boolean;
  nota_fiscal_id?: string | null;
};

export type AzoupFaturasData = {
  gerado_em: string;
  from: string | null;
  to: string | null;
  total: number;
  faturas: AzoupFaturaResumo[];
};
