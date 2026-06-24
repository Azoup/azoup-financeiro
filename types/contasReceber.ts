export type PerfilCobranca = {
  user_id: string;
  razao_social: string;
  documento: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  cooperativa_nome: string | null;
  codigo_beneficiario_agencia: string | null;
  telefone_suporte: string | null;
  instrucoes_cobranca: string;
  local_pagamento: string;
  mensagem_padrao_pagador: string | null;
  created_at: string;
  updated_at: string;
};

export type PerfilCobrancaInput = {
  razao_social: string;
  documento: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  cooperativa_nome: string | null;
  codigo_beneficiario_agencia: string | null;
  telefone_suporte: string | null;
  instrucoes_cobranca: string;
  local_pagamento: string;
  mensagem_padrao_pagador: string | null;
};

import type { ContaReceberSituacao } from '@/utils/contaReceberCobranca';

export type ContaReceberOrigem = 'venda' | 'mensalidade';

import type { BoletoStatusRegistro, BoletoTipoEmissao } from '@/types/sicoob';

export type BoletoParcelaVendaRow = {
  id: string;
  user_id: string;
  origem: ContaReceberOrigem;
  venda_id: string | null;
  parcela_id: string | null;
  mensalidade_id: string | null;
  numero_parcela: number;
  total_parcelas_venda: number;
  beneficiario_razao_social: string;
  beneficiario_documento: string;
  beneficiario_endereco: string;
  beneficiario_bairro: string;
  beneficiario_cidade_uf_cep: string;
  pagador_nome: string;
  pagador_documento: string;
  pagador_endereco: string;
  pagador_cidade_uf_cep: string;
  mensagem_pagador: string | null;
  venda_descricao_resumo: string;
  valor_documento: number;
  data_vencimento: string;
  data_documento: string;
  nosso_numero: string;
  numero_documento: string;
  local_pagamento: string;
  instrucoes: string;
  cooperativa_rodape: string | null;
  tipo_emissao: BoletoTipoEmissao;
  status_registro: BoletoStatusRegistro;
  linha_digitavel: string | null;
  codigo_barras: string | null;
  nosso_numero_banco: string | null;
  sicoob_seu_numero: string | null;
  pdf_storage_path: string | null;
  pdf_url: string | null;
  mensagem_erro_registro: string | null;
  data_registro: string | null;
  data_liquidacao_sicoob: string | null;
  ultima_consulta_sicoob: string | null;
  nota_fiscal_id: string | null;
  created_at: string;
};

export type ContaReceberListRow = BoletoParcelaVendaRow & {
  /** Status da parcela (venda) ou da mensalidade gerada. */
  parcela_status: string;
  /** Aberto (pendente/parcial/atrasado), pago ou cancelado — para filtros de cobrança. */
  situacao_cobranca: ContaReceberSituacao;
  nome_cliente: string;
  referencia_label: string;
  cliente_id: string | null;
  /** WhatsApp do cadastro do cliente (contatos, tipo whatsapp). */
  whatsapp: string | null;
  whatsapp_contato_nome: string | null;
};
