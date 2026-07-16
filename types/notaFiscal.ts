export type NotaFiscalStatus =
  | 'rascunho'
  | 'processando'
  | 'autorizada'
  | 'rejeitada'
  | 'cancelada';

export type TipoDocumentoFiscal = 'nfse' | 'nfe';

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
  inscricao_municipal: string;
  codigo_tributacao_nacional: string;
  /** cTribMun — até 3 dígitos; vazio se o município não exigir. */
  codigo_tributacao_municipal: string;
  codigo_nbs: string;
  op_simp_nac: 1 | 2 | 3 | 4;
  reg_esp_trib: number;
  trib_issqn: 1 | 2 | 3 | 4;
  tp_ret_issqn: 1 | 2 | 3;
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
  venda_id: string | null;
  cliente_id: string;
  serie: string;
  numero: number;
  status: NotaFiscalStatus;
  tipo_documento: TipoDocumentoFiscal;
  status_sefaz: string | null;
  chave_acesso: string | null;
  protocolo_autorizacao: string | null;
  codigo_verificacao: string | null;
  xml_autorizado: string | null;
  danfe_url: string | null;
  danfe_storage_path: string | null;
  valor_total: number;
  data_emissao: string;
  natureza_operacao: string;
  ambiente: 1 | 2;
  motivo_rejeicao: string | null;
  motivo_cancelamento?: string | null;
  data_cancelamento?: string | null;
  competencia: string | null;
  created_at: string;
  updated_at: string;
};

export type NotaFiscalListRow = NotaFiscal & {
  cliente?: { nome_cliente: string; nome_empresa: string | null } | null;
};

export type CancelarNfeResult = {
  success: boolean;
  status?: string;
  message?: string;
};

export type EmitirNfeResult = {
  success: boolean;
  status?: string;
  chave_acesso?: string;
  protocolo_autorizacao?: string;
  codigo_verificacao?: string;
  danfe_url?: string;
  message?: string;
};

/** Ambiente fiscal de emissão NFS-e: 1 = produção, 2 = homologação. */
export const AMBIENTE_FISCAL_PRODUCAO = 1 as const;
export const AMBIENTE_FISCAL_HOMOLOGACAO = 2 as const;
/** Ambiente em uso no app (produção). */
export const AMBIENTE_FISCAL_ATUAL = AMBIENTE_FISCAL_PRODUCAO;
