export type AzoupStatusGrupo = 'ativa' | 'trial' | 'inadimplente' | 'cancelada' | 'outro';

export type AzoupPlanoResumo = {
  plano_id: string;
  nome: string;
  ativos: number;
  inativos: number;
  total: number;
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
  valor_centavos: number;
};

export type AzoupDashboardData = {
  gerado_em: string;
  mrr_fonte: 'stripe' | 'local';
  total_clientes: number;
  clientes_assinatura_ativa: number;
  clientes_trial: number;
  clientes_inadimplentes: number;
  clientes_cancelados: number;
  mrr_centavos: number;
  mrr_bruto_centavos: number;
  desconto_centavos: number;
  assinaturas_com_desconto: number;
  planos_clientes: AzoupPlanoResumo[];
  clientes: AzoupClienteResumo[];
};
