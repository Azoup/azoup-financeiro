export type TipoContato = 'email' | 'whatsapp';

export type SortField = 'nome_cliente' | 'valor_mensalidade' | 'created_at' | 'segmento_cliente_codigo';
export type SortOrder = 'asc' | 'desc';

export interface ContatoCliente {
  id: string;
  cliente_id: string;
  nome_contato: string;
  tipo_contato: TipoContato;
  valor_contato: string;
  created_at: string;
}

export interface ContatoClienteInput {
  nome_contato: string;
  tipo_contato: TipoContato;
  valor_contato: string;
}

export interface Cliente {
  id: string;
  user_id: string;
  documento: string;
  /** CNPJ do cliente (PJ), independente do documento interno. */
  cnpj?: string;
  nome_cliente: string;
  nome_empresa: string | null;
  mes_entrada: string | null;
  valor_mensalidade: number | null;
  /** Mensalidade vigente antes do último reajuste (null = nunca registrado). */
  valor_mensalidade_anterior?: number | null;
  /** Código do segmento (FK `segmento_cliente.codigo`). Ausente até migration 008. */
  segmento_cliente_codigo?: string;
  /** Legado; pode ficar nulo após migration 008. */
  tipo_ramo?: string | null;
  /** @deprecated Preferir `dia_vencimento`. Mantido para compatibilidade. */
  data_inicio: string | null;
  /** Dia do mês (1–31) para vencimento das mensalidades. */
  dia_vencimento: number | null;
  data_reajuste: string | null;
  /** Data que estava em data_reajuste antes da última alteração. */
  ultimo_reajuste: string | null;
  observacao: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  pdf_path: string | null;
  /** Quando true, cliente cancelado (não entra nos totais ativos do painel). Ausente = ativo. */
  cancelado?: boolean;
  /** Texto da última justificativa de cancelamento (preenchido só no detalhe). */
  ultima_justificativa_cancelamento?: string | null;
  /** true = com NF (nota fiscal); false = sem NF. Ausente até migration 014 = sem NF. */
  emite_nf?: boolean;
  /** mensal | anual — faturamento da cobrança. */
  tipo_faturamento: 'mensal' | 'anual';
  /** Qtd. de parcelas no ano quando tipo_faturamento=anual (1,2,3,4,6,12). */
  parcelas_anuais: number | null;
  /** Inscrição estadual do cliente (PJ). */
  inscricao_estadual?: string;
  /** Join opcional (lista/detalhe). */
  segmento_cliente?: { codigo: string; nome: string } | null;
  created_at: string;
  updated_at?: string;
}

export interface ClienteListItem extends Cliente {
  contatos_count?: number;
}

export interface ClienteFormValues {
  /** Documento interno (ex.: ZPF - N). Vazio no cadastro gera ZPF automaticamente. */
  documento: string;
  /** CNPJ mascarado; opcional e independente do documento. */
  cnpj: string;
  inscricao_estadual: string;
  nome_cliente: string;
  nome_empresa: string;
  mes_entrada: string;
  /** Somente leitura no formulário; atualizado ao reajustar ou ao mudar a mensalidade. */
  valor_mensalidade_anterior: string;
  valor_mensalidade: string;
  segmento_cliente_codigo: string;
  /** Dia do mês (1–31) como texto no formulário. */
  dia_vencimento: string;
  data_reajuste: Date | null;
  /** Somente leitura / espelho: atualiza ao mudar a data de reajuste; persistido no servidor. */
  ultimo_reajuste: Date | null;
  observacao: string;
  contatos: ContatoClienteInput[];
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  /** Caminho no bucket após salvo (somente leitura no formulário de edição). */
  pdfPath: string | null;
  /** URI local do arquivo escolhido (upload após salvar). */
  pdfLocalUri: string | null;
  /** Nome exibido do arquivo local. */
  pdfFileName: string | null;
  cancelado: boolean;
  /** Motivo ao marcar como cancelado (obrigatório na transição ativo → cancelado). */
  cancelamento_justificativa: string;
  /** Com NF (nota fiscal) ou sem NF. */
  emite_nf: boolean;
  /** mensal | anual */
  tipo_faturamento: 'mensal' | 'anual';
  /** Texto 1|2|3|4|6|12 quando anual. */
  parcelas_anuais: string;
}

export interface SegmentoClienteRow {
  codigo: string;
  nome: string;
  ordem?: number;
  created_at?: string;
}

export interface TipoRamoRow {
  id: string;
  nome: string;
  created_at: string;
}
