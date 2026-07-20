import { addDaysToISODate, parseISODate, toISODate } from '@/utils/date';

export type CalcProximoVencimentoInput = {
  /** Dia do mês de vencimento no cadastro (1–31). */
  diaVencimento: number | null;
  /**
   * @deprecated Preferir `diaVencimento`. Se dia não informado, extrai o dia de `dataInicio`.
   */
  dataInicio?: string | null;
  /** Maior `data_vencimento` já gerada para o cliente (mensalidade anterior). */
  ultimoVencimento: string | null;
  /** Referência (geração); padrão = hoje (YYYY-MM-DD). */
  hoje?: string;
};

export function normalizeDiaVencimento(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return n;
}

/** Dia efetivo no mês (ex.: 31 em fevereiro → 28/29). */
export function clampDiaNoMes(year: number, monthIndex: number, dia: number): number {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, dia), last);
}

/**
 * Próxima ocorrência do dia `dia` a partir de `fromIso` (inclusive).
 * Ex.: de 2026-07-05 com dia 10 → 2026-07-10; de 2026-07-15 com dia 10 → 2026-08-10.
 */
export function proximaDataDiaMes(dia: number, fromIso?: string | null): string | null {
  const d = normalizeDiaVencimento(dia);
  if (d == null) return null;

  const base = fromIso?.trim() ? parseISODate(fromIso.trim()) : new Date();
  if (!base) return null;

  let y = base.getFullYear();
  let m = base.getMonth();
  const dayOfMonth = base.getDate();

  const thisMonthDay = clampDiaNoMes(y, m, d);
  if (dayOfMonth <= thisMonthDay) {
    return toISODate(new Date(y, m, thisMonthDay));
  }

  m += 1;
  if (m > 11) {
    m = 0;
    y += 1;
  }
  return toISODate(new Date(y, m, clampDiaNoMes(y, m, d)));
}

function resolveDia(input: CalcProximoVencimentoInput): number | null {
  const fromField = normalizeDiaVencimento(input.diaVencimento);
  if (fromField != null) return fromField;
  const inicio = (input.dataInicio ?? '').trim();
  if (!inicio) return null;
  const parsed = parseISODate(inicio);
  if (!parsed) return null;
  return parsed.getDate();
}

/**
 * Próxima data de vencimento da mensalidade:
 * - Usa o dia do mês do cadastro a partir da data de geração (hoje).
 * - Se já existe vencimento gerado, avança mês a mês até ficar depois do último.
 */
export function calcProximoVencimentoMensalidade(input: CalcProximoVencimentoInput): Date | null {
  const hoje = input.hoje ?? toISODate(new Date());
  const dia = resolveDia(input);
  if (dia == null) return null;

  let next = proximaDataDiaMes(dia, hoje);
  if (!next) return null;

  const ultimo = (input.ultimoVencimento ?? '').trim();
  if (ultimo) {
    while (next <= ultimo) {
      next = proximaDataDiaMes(dia, addDaysToISODate(next, 1));
      if (!next) return null;
    }
  }

  return parseISODate(next);
}

export function calcProximoVencimentoIso(input: CalcProximoVencimentoInput): string | null {
  const d = calcProximoVencimentoMensalidade(input);
  return d ? toISODate(d) : null;
}

export function labelDiaVencimento(dia: number | null | undefined): string {
  const n = normalizeDiaVencimento(dia);
  if (n == null) return '—';
  return `Dia ${n}`;
}
