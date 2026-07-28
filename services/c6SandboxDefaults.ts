/**
 * Credenciais sandbox C6 Developers (homologação).
 * CNPJ cobrador = emitente 2 (não padrão) da NFS-e.
 */
export const C6_SANDBOX_DEFAULTS = {
  client_id: '3cbe1db9-ee03-4f3b-aae4-b0ea2e649cee',
  client_secret: 'jHM5711Cz2O6RHVpD79QKlqyhJipDyGf',
  pix_chave: '46bbfecb-540d-457d-abfd-7ef140886d3c',
  ambiente: 'sandbox' as const,
  billing_scheme: '21',
  ativo: true,
};
