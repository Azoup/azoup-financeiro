/** Situação de cobrança unificada (parcela de venda ou mensalidade gerada). */
export type ContaReceberSituacao = 'aberto' | 'pago' | 'cancelado';

export function situacaoCobrancaDeStatus(parcelaStatus: string): ContaReceberSituacao {
  const s = (parcelaStatus ?? '').toLowerCase();
  if (s === 'cancelado' || s === 'cancelada') return 'cancelado';
  if (s === 'pago' || s === 'quitada' || s === 'quitado') return 'pago';
  return 'aberto';
}

export function labelSituacaoCobranca(situacao: ContaReceberSituacao): string {
  switch (situacao) {
    case 'pago':
      return 'Pago';
    case 'cancelado':
      return 'Cancelado';
    default:
      return 'Em aberto';
  }
}

/**
 * Valor a exibir na lista: se houve baixa, usa o valor pago (já líquido de desconto);
 * senão o valor do documento.
 */
export function valorExibicaoContaReceber(row: {
  valor_documento: number;
  valor_pago?: number | null;
}): number {
  const pago = Number(row.valor_pago) || 0;
  if (pago > 0) return pago;
  return Number(row.valor_documento) || 0;
}
