export const CNPJ_INPUT_MASK = [
  /\d/,
  /\d/,
  '.',
  /\d/,
  /\d/,
  /\d/,
  '.',
  /\d/,
  /\d/,
  /\d/,
  '/',
  /\d/,
  /\d/,
  /\d/,
  /\d/,
  '-',
  /\d/,
  /\d/,
] as const;

export function onlyDigitsCnpj(value: string): string {
  return value.replace(/\D/g, '').slice(0, 14);
}

export function isCnpjDigitsComplete(value: string): boolean {
  return onlyDigitsCnpj(value).length === 14;
}

export function formatCnpjMasked(digits: string): string {
  const d = onlyDigitsCnpj(digits);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function isZpfDocumento(doc: string): boolean {
  return /^ZPF\s*-\s*\d+$/i.test(doc.trim());
}

/** Exibe CNPJ mascarado se o documento tiver 14 dígitos; senão vazio (ZPF/CPF/outro). */
export function documentoToCnpjField(doc: string): string {
  const trimmed = doc.trim();
  if (!trimmed || isZpfDocumento(trimmed)) return '';
  const digits = onlyDigitsCnpj(trimmed);
  if (digits.length === 14) return formatCnpjMasked(digits);
  return trimmed;
}

export function formatCepFromDigits(cep: string): string {
  const d = cep.replace(/\D/g, '').slice(0, 8);
  if (d.length !== 8) return cep.trim();
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
