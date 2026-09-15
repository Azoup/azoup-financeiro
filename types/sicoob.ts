export type SicoobAmbiente = 'sandbox' | 'producao';

export type SicoobConfig = {
  user_id: string;
  ativo: boolean;
  ambiente: SicoobAmbiente;
  client_id: string;
  numero_cliente: number;
  numero_conta_corrente: number;
  codigo_modalidade: number;
  codigo_especie_documento: string;
  identificacao_emissao_boleto: number;
  identificacao_distribuicao_boleto: number;
  gerar_pix_boleto: boolean;
  webhook_token: string | null;
  created_at: string;
  updated_at: string;
};

export type SicoobConfigInput = {
  ativo: boolean;
  ambiente: SicoobAmbiente;
  client_id: string;
  numero_cliente: number;
  numero_conta_corrente: number;
  codigo_modalidade: number;
  codigo_especie_documento: string;
  identificacao_emissao_boleto: number;
  identificacao_distribuicao_boleto: number;
  gerar_pix_boleto: boolean;
  webhook_token: string | null;
};

export type BoletoStatusRegistro =
  | 'informativo'
  | 'pendente'
  | 'registrado'
  | 'erro'
  | 'baixado'
  | 'pago';

export type BoletoTipoEmissao = 'informativo' | 'sicoob' | 'c6';

export type EmitirBoletoEmailResult = {
  enviado?: boolean;
  skipped?: boolean;
  reason?: string;
  to?: string;
  error?: string;
  id?: string | null;
};

export type EmitirBoletoSicoobResult = {
  success: boolean;
  boletoId: string;
  emitido_agora?: boolean;
  status_registro?: BoletoStatusRegistro;
  linha_digitavel?: string | null;
  codigo_barras?: string | null;
  nosso_numero_banco?: string | null;
  pdf_url?: string | null;
  message?: string;
  email?: EmitirBoletoEmailResult;
};

export type EmitirBoletoLoteResult = {
  success: boolean;
  emitidos: number;
  erros: string[];
  resultados: EmitirBoletoSicoobResult[];
  emails_enviados?: number;
  emails_ignorados?: number;
  emails_erro?: number;
};
