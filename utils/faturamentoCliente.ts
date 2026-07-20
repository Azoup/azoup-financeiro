import { parseBRLMasked } from '@/utils/currency';
import { addMonthsToISODate } from '@/utils/date';
import { calcProximoVencimentoIso } from '@/utils/mensalidadeVencimento';

export type TipoFaturamento = 'mensal' | 'anual';

/** Divisores de 12 — espaçamento de vencimento limpo (12/N meses). */
export const PARCELAS_ANUAIS_OPCOES = [1, 2, 3, 4, 6, 12] as const;
export type ParcelasAnuais = (typeof PARCELAS_ANUAIS_OPCOES)[number];

export function normalizeTipoFaturamento(raw: unknown): TipoFaturamento {
  return String(raw ?? '').trim().toLowerCase() === 'anual' ? 'anual' : 'mensal';
}

export function normalizeParcelasAnuais(raw: unknown): ParcelasAnuais | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  return (PARCELAS_ANUAIS_OPCOES as readonly number[]).includes(n) ? (n as ParcelasAnuais) : null;
}

/** Total anual e valor de cada parcela; última parcela absorve centavos de arredondamento. */
export function calcValoresParcelasAnuais(
  valorMensalidade: number,
  parcelas: number,
): { totalAnual: number; valores: number[] } {
  const n = normalizeParcelasAnuais(parcelas) ?? 12;
  const totalAnual = Math.round(valorMensalidade * 12 * 100) / 100;
  if (n <= 1) {
    return { totalAnual, valores: [totalAnual] };
  }
  const base = Math.floor((totalAnual * 100) / n) / 100;
  const valores = Array.from({ length: n }, () => base);
  const somaBase = Math.round(base * n * 100) / 100;
  const diff = Math.round((totalAnual - somaBase) * 100) / 100;
  valores[n - 1] = Math.round((base + diff) * 100) / 100;
  return { totalAnual, valores };
}

export function labelTipoFaturamento(tipo: TipoFaturamento | null | undefined): string {
  return tipo === 'anual' ? 'Faturamento anual' : 'Faturamento mensal';
}

export type PlanoParcelaAnual = {
  parcela_numero: number;
  parcela_total: number;
  valor: number;
  data_vencimento: string;
};

/**
 * Monta as N parcelas anuais a partir do próximo vencimento (dia do cadastro).
 * Espaçamento: 12/N meses entre parcelas.
 */
export function montarParcelasAnuais(input: {
  valorMensalidade: number;
  parcelas: number;
  diaVencimento: number | null;
  dataInicio?: string | null;
  ultimoVencimento?: string | null;
  hoje?: string;
}): PlanoParcelaAnual[] | null {
  const n = normalizeParcelasAnuais(input.parcelas);
  if (n == null || input.valorMensalidade <= 0) return null;

  const primeiro = calcProximoVencimentoIso({
    diaVencimento: input.diaVencimento,
    dataInicio: input.dataInicio ?? null,
    ultimoVencimento: input.ultimoVencimento ?? null,
    hoje: input.hoje,
  });
  if (!primeiro) return null;

  const { valores } = calcValoresParcelasAnuais(input.valorMensalidade, n);
  const passoMeses = 12 / n;
  return valores.map((valor, i) => ({
    parcela_numero: i + 1,
    parcela_total: n,
    valor,
    data_vencimento: i === 0 ? primeiro : addMonthsToISODate(primeiro, i * passoMeses),
  }));
}

export function previewFaturamentoAnual(valorMensalidadeStr: string, parcelas: number): string | null {
  const valor = parseBRLMasked(valorMensalidadeStr);
  if (valor == null || valor <= 0) return null;
  const n = normalizeParcelasAnuais(parcelas);
  if (n == null) return null;
  const { totalAnual, valores } = calcValoresParcelasAnuais(valor, n);
  const parcela = valores[0] ?? 0;
  const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return `12 × ${fmt(valor)} = ${fmt(totalAnual)} ÷ ${n} = ${fmt(parcela)} por parcela`;
}
