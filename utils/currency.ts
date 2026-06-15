export function formatBRL(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/** Converte string mascarada (ex.: R$ 1.234,56) em número. */
export function parseBRLMasked(input: string): number | null {
  const digits = input.replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits) / 100;
}
