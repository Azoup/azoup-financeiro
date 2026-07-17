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

export function labelTipoDocumentoFiscal(tipo: string | undefined | null): string {
  return tipo === 'nfe' ? 'NF-e' : 'NFS-e';
}

export function podeImprimirDanfe(nota: {
  status: string;
  danfe_url?: string | null;
  codigo_verificacao?: string | null;
  chave_acesso?: string | null;
  xml_autorizado?: string | null;
}): boolean {
  if (nota.status !== 'autorizada') return false;
  return Boolean(
    nota.danfe_url?.trim() ||
      nota.codigo_verificacao?.trim() ||
      nota.chave_acesso?.trim() ||
      nota.xml_autorizado?.trim(),
  );
}

export function podeBaixarXmlNfse(nota: {
  status: string;
  xml_autorizado?: string | null;
}): boolean {
  return nota.status === 'autorizada' && Boolean(nota.xml_autorizado?.trim());
}

export function podeCancelarNotaFiscal(nota: {
  status: string;
  chave_acesso?: string | null;
  protocolo_autorizacao?: string | null;
  tipo_documento?: string | null;
}): boolean {
  if (nota.status !== 'autorizada' || !nota.chave_acesso?.trim()) return false;
  // NFS-e (padrão do app) ou tipo ausente em registros antigos.
  if (!nota.tipo_documento || nota.tipo_documento === 'nfse') return true;
  return Boolean(nota.protocolo_autorizacao?.trim());
}

export function podeReemitirNotaFiscal(nota: { status: string }): boolean {
  return nota.status === 'rascunho' || nota.status === 'processando' || nota.status === 'rejeitada';
}

export function isAmbienteHomologacao(ambiente: number): boolean {
  return ambiente !== 1;
}
