/** Mesma regra do aplicativo do banco: multa de 2% uma vez e juros de 0,033% ao dia. */
const MULTA_PERCENTUAL = 2;
const JUROS_PERCENTUAL_AO_DIA = 0.033;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function hojeBrasilIso(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

function diaSeguinte(iso) {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function diasAtraso(vencimentoIso, hojeIso) {
  const venc = String(vencimentoIso ?? '').slice(0, 10);
  const hoje = String(hojeIso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje)) return 0;
  const [y1, m1, d1] = venc.split('-').map(Number);
  const [y2, m2, d2] = hoje.split('-').map(Number);
  const dias = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  return dias > 0 ? dias : 0;
}

function calcularEncargosBoleto(valorDocumento, vencimentoIso, hojeIso = hojeBrasilIso()) {
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

/** Campos de multa e juros para a inclusão Sicoob. A data começa no dia seguinte ao vencimento. */
function camposMultaJurosSicoob(dataVencimento) {
  const inicio = diaSeguinte(dataVencimento);
  if (!inicio) return { tipoMulta: 0, tipoJurosMora: 3 };
  return {
    tipoMulta: 2,
    dataMulta: inicio,
    valorMulta: MULTA_PERCENTUAL,
    tipoJurosMora: 2,
    dataJurosMora: inicio,
    valorJurosMora: round2(JUROS_PERCENTUAL_AO_DIA * 30),
  };
}

function camposMultaJurosC6() {
  return {
    interest: { value: JUROS_PERCENTUAL_AO_DIA },
    fine: { value: MULTA_PERCENTUAL },
  };
}

module.exports = {
  MULTA_PERCENTUAL,
  JUROS_PERCENTUAL_AO_DIA,
  calcularEncargosBoleto,
  camposMultaJurosSicoob,
  camposMultaJurosC6,
  hojeBrasilIso,
};
