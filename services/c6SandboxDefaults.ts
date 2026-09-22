/**
 * Credenciais C6 Bank — CNPJs cobradores conhecidos (portal C6).
 * Ambiente ativo: produção (boletos reais na CIP).
 * Credenciais reais devem ser cadastradas em Configurações › Boleto C6.
 */
export const C6_CNPJ_COBRADOR = '05320214000169';
/** AZFS Tecnologia — CNPJ liberado para boleto C6 no sistema. */
export const C6_CNPJ_AZFS = '66639480000143';
export const C6_CNPJS_COBRADOR = [C6_CNPJ_COBRADOR, C6_CNPJ_AZFS] as const;

/** Homologação (referência / evidências). */
export const C6_SANDBOX_DEFAULTS = {
  client_id: '3cbe1db9-ee03-4f3b-aae4-b0ea2e649cee',
  client_secret: 'jHM5711Cz2O6RHVpD79QKlqyhJipDyGf',
  pix_chave: '46bbfecb-540d-457d-abfd-7ef140886d3c',
  ambiente: 'sandbox' as const,
  billing_scheme: '21',
  ativo: true,
};

/** Produção — boleto registrado na base centralizada (CIP). */
export const C6_PROD_DEFAULTS = {
  client_id: '5204f13e-ddca-4db5-8c1f-e463fa2d0623',
  client_secret: '994HNeachRXeiKg4RnHPJEiOUZFjucKb',
  /** Preencha com a chave Pix da conta PJ em produção, se usar Pix cobv. */
  pix_chave: '' as string,
  ambiente: 'producao' as const,
  billing_scheme: '15',
  ativo: true,
};

/** Defaults ativos do sistema (produção). */
export const C6_ACTIVE_DEFAULTS = C6_PROD_DEFAULTS;

export function onlyDigitsCnpj(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function isC6CobradorCnpj(documento: string | null | undefined): boolean {
  const d = onlyDigitsCnpj(documento);
  return (C6_CNPJS_COBRADOR as readonly string[]).includes(d);
}
