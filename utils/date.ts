export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** `MM/AAAA` → { year, month } (month 1–12) ou null. */
export function parseMesAnoBR(s: string): { year: number; month: number } | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const year = Number(m[2]);
  if (month < 1 || month > 12 || year < 1900 || year > 2100) return null;
  return { year, month };
}

export function formatMesAnoBR(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

export function mesAnoAtualBR(): string {
  const d = new Date();
  return formatMesAnoBR(d.getFullYear(), d.getMonth() + 1);
}

const NOMES_MES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export function labelMesAnoBR(year: number, month: number): string {
  const nome = NOMES_MES[month - 1] ?? String(month);
  return `${nome}/${year}`;
}

/** Intervalo ISO (inclusive) do 1º ao último dia do mês civil. */
export function isoRangeMesCalendario(year: number, month: number): { de: string; ate: string } {
  const de = `${year}-${String(month).padStart(2, '0')}-01`;
  const ultimoDia = new Date(year, month, 0).getDate();
  const ate = `${year}-${String(month).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { de, ate };
}

/** Soma dias a uma data ISO `yyyy-MM-dd` (calendário local). */
export function addDaysToISODate(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function formatBRDate(d: Date | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('pt-BR').format(d);
}

/** `dd/MM/yyyy` completo; retorna `null` se o formato ou o calendário forem inválidos. */
export function parseBRDateDMY(s: string): Date | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Formata instante ISO (ex.: created_at do Supabase) em pt-BR com data e hora. */
export function formatDateTimeBRFromISO(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
