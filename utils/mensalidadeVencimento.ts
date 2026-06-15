import { addDaysToISODate, parseISODate, toISODate } from '@/utils/date';

const INTERVALO_DIAS = 30;

export type CalcProximoVencimentoInput = {
  /** Primeiro vencimento do cadastro do cliente (`data_inicio`). */
  dataInicio: string | null;
  /** Maior `data_vencimento` já gerada para o cliente (mensalidade anterior). */
  ultimoVencimento: string | null;
  /** Referência; padrão = hoje. */
  hoje?: string;
};

/**
 * Próxima data de vencimento da mensalidade:
 * 1) Se já houve geração → último vencimento + 30 dias (avança de 30 em 30 se ainda estiver no passado).
 * 2) Senão → primeiro vencimento do cadastro; se já passou, +30 até ficar em dia.
 */
export function calcProximoVencimentoMensalidade(input: CalcProximoVencimentoInput): Date | null {
  const hoje = input.hoje ?? toISODate(new Date());

  if (input.ultimoVencimento) {
    let next = addDaysToISODate(input.ultimoVencimento, INTERVALO_DIAS);
    while (next < hoje) {
      next = addDaysToISODate(next, INTERVALO_DIAS);
    }
    return parseISODate(next);
  }

  const inicio = (input.dataInicio ?? '').trim();
  if (!inicio) return null;

  if (inicio >= hoje) {
    return parseISODate(inicio);
  }

  let next = inicio;
  while (next < hoje) {
    next = addDaysToISODate(next, INTERVALO_DIAS);
  }
  return parseISODate(next);
}

export function calcProximoVencimentoIso(input: CalcProximoVencimentoInput): string | null {
  const d = calcProximoVencimentoMensalidade(input);
  return d ? toISODate(d) : null;
}
