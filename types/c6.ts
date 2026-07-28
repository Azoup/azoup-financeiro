export type C6Ambiente = 'sandbox' | 'producao';

export type C6Config = {
  user_id: string;
  emitente_id: string;
  ativo: boolean;
  ambiente: C6Ambiente;
  client_id: string;
  client_secret: string;
  billing_scheme: string;
  cert_crt_storage_path: string | null;
  cert_key_storage_path: string | null;
  webhook_token: string | null;
  created_at: string;
  updated_at: string;
};

export type C6ConfigInput = {
  emitente_id: string;
  ativo: boolean;
  ambiente: C6Ambiente;
  client_id: string;
  client_secret: string;
  billing_scheme: string;
  webhook_token: string | null;
  /** Mantém paths existentes se null (não sobrescreve). */
  cert_crt_storage_path?: string | null;
  cert_key_storage_path?: string | null;
};

export type EmitirBoletoC6Result = {
  success: boolean;
  boletoId: string;
  status_registro?: string;
  linha_digitavel?: string | null;
  codigo_barras?: string | null;
  nosso_numero_banco?: string | null;
  c6_boleto_id?: string | null;
  pdf_url?: string | null;
  message?: string;
};
