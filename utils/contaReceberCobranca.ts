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
