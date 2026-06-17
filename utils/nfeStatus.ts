/** Rótulos amigáveis do status interno da NF-e. */
export function labelNotaFiscalStatus(status: string): string {
  switch (status) {
    case 'rascunho':
      return 'Rascunho';
    case 'processando':
      return 'Processando';
    case 'autorizada':
      return 'Autorizada';
    case 'rejeitada':
      return 'Rejeitada';
    case 'cancelada':
      return 'Cancelada';
    default:
      return status;
  }
}

export function corNotaFiscalStatus(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'autorizada':
      return { bg: '#e8f5e9', fg: '#2e7d32' };
    case 'processando':
      return { bg: '#e3f2fd', fg: '#1565c0' };
    case 'rejeitada':
      return { bg: '#ffebee', fg: '#c62828' };
    case 'cancelada':
      return { bg: '#f5f5f5', fg: '#616161' };
    default:
      return { bg: '#fff3e0', fg: '#e65100' };
  }
}

export function labelAmbienteNfe(ambiente: number): string {
  return ambiente === 1 ? 'Produção' : 'Homologação';
}

export function podeImprimirDanfe(nota: { status: string; danfe_url?: string | null }): boolean {
  return nota.status === 'autorizada' && Boolean(nota.danfe_url?.trim());
}

export function podeCancelarNotaFiscal(nota: {
  status: string;
  chave_acesso?: string | null;
  protocolo_autorizacao?: string | null;
}): boolean {
  return (
    nota.status === 'autorizada' &&
    Boolean(nota.chave_acesso?.trim()) &&
    Boolean(nota.protocolo_autorizacao?.trim())
  );
}

export function isAmbienteHomologacao(ambiente: number): boolean {
  return ambiente !== 1;
}
