/** Mesma regra do aplicativo do banco: multa de 2% uma vez e juros de 0,033% ao dia. */
export const MULTA_PERCENTUAL = 2;
export const JUROS_PERCENTUAL_AO_DIA = 0.033;

export type EncargosBoleto = {
  vencido: boolean;
  dias: number;
  multa: number;
  juros: number;
  total: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function hojeBrasilIso(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

function diasAtraso(vencimentoIso: string, hojeIso: string): number {
  const venc = String(vencimentoIso ?? '').slice(0, 10);
  const hoje = String(hojeIso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje)) return 0;
  const [y1, m1, d1] = venc.split('-').map(Number);
  const [y2, m2, d2] = hoje.split('-').map(Number);
  const dias = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  return dias > 0 ? dias : 0;
}

export function calcularEncargosBoleto(
  valorDocumento: number,
  vencimentoIso: string,
  hojeIso = hojeBrasilIso(),
): EncargosBoleto {
  const valor = round2(Number(valorDocumento) || 0);
  const dias = diasAtraso(vencimentoIso, hojeIso);
  if (dias <= 0) {
    return { vencido: false, dias: 0, multa: 0, juros: 0, total: valor };
  }
  const multa = round2(valor * (MULTA_PERCENTUAL / 100));
  const juros = round2(valor * (JUROS_PERCENTUAL_AO_DIA / 100) * dias);
  return {
    vencido: true,
    dias,
    multa,
    juros,
    total: round2(valor + multa + juros),
  };
}
