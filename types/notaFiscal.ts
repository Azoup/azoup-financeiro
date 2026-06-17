export type NotaFiscalStatus =
  | 'rascunho'
  | 'processando'
  | 'autorizada'
  | 'rejeitada'
  | 'cancelada';

export type NfeConfig = {
  user_id: string;
  serie: string;
  proximo_numero: number;
  ambiente: 1 | 2;
  inscricao_estadual: string;
  regime_tributario: 1 | 2 | 3;
  codigo_ibge_emitente: string;
  ncm_servico: string;
  cfop_padrao: string;
  cst_icms: string;
  csosn: string;
  descricao_servico_padrao: string;
  natureza_operacao: string;
  created_at: string;
  updated_at: string;
};

export type NfeConfigInput = Omit<NfeConfig, 'user_id' | 'created_at' | 'updated_at'>;

export type EmpresaCertificado = {
  id: string;
  user_id: string;
  storage_path: string;
  valido_ate: string | null;
  ativo: boolean;
  created_at: string;
};

export type NotaFiscal = {
  id: string;
  user_id: string;
  mensalidade_id: string | null;
  cliente_id: string;
  serie: string;
  numero: number;
  status: NotaFiscalStatus;
  status_sefaz: string | null;
  chave_acesso: string | null;
  protocolo_autorizacao: string | null;
  xml_autorizado: string | null;
  danfe_url: string | null;
  danfe_storage_path: string | null;
  valor_total: number;
  data_emissao: string;
  natureza_operacao: string;
  ambiente: 1 | 2;
  motivo_rejeicao: string | null;
  competencia: string | null;
  created_at: string;
  updated_at: string;
};

export type NotaFiscalListRow = NotaFiscal & {
  cliente?: { nome_cliente: string; nome_empresa: string | null } | null;
};

export type EmitirNfeResult = {
  success: boolean;
  status?: string;
  chave_acesso?: string;
  protocolo_autorizacao?: string;
  danfe_url?: string;
  message?: string;
};
