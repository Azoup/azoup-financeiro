/** Coerce qualquer valor para string e aplica trim com segurança. */
export function safeTrim(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

export function safeNonEmpty(value: unknown): string | null {
  const s = safeTrim(value);
  return s || null;
}
