/**
 * Credenciais sandbox C6 Developers (homologação).
 * CNPJ cobrador configurado no portal C6: 05.320.214/0001-69
 */
export const C6_CNPJ_COBRADOR = '05320214000169';

export const C6_SANDBOX_DEFAULTS = {
  client_id: '3cbe1db9-ee03-4f3b-aae4-b0ea2e649cee',
  client_secret: 'jHM5711Cz2O6RHVpD79QKlqyhJipDyGf',
  pix_chave: '46bbfecb-540d-457d-abfd-7ef140886d3c',
  ambiente: 'sandbox' as const,
  billing_scheme: '21',
  ativo: true,
};

export function onlyDigitsCnpj(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function isC6CobradorCnpj(documento: string | null | undefined): boolean {
  return onlyDigitsCnpj(documento) === C6_CNPJ_COBRADOR;
}
