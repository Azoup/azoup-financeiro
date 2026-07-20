export type OpSimpNac = 1 | 2 | 3 | 4;
export type RegimeTributario = 1 | 2 | 3;
/** Apuração federal sob Regime Normal (CRT 3). */
export type TipoApuracaoNormal = 'presumido' | 'real';

/** CRT / regime do emitente (mesmo código usado em NF-e). */
export const REGIME_TRIBUTARIO_OPCOES: { value: RegimeTributario; label: string }[] = [
  { value: 1, label: 'Simples Nacional' },
  { value: 2, label: 'Simples Nacional — excesso de sublimite' },
  { value: 3, label: 'Regime Normal' },
];

export const TIPO_APURACAO_OPCOES: { value: TipoApuracaoNormal; label: string; hint: string }[] = [
  {
    value: 'presumido',
    label: 'Lucro Presumido',
    hint: 'IRPJ/CSLL por presunção. PIS/COFINS em geral cumulativo (alíquotas fixas do serviço).',
  },
  {
    value: 'real',
    label: 'Lucro Real',
    hint: 'IRPJ/CSLL sobre o lucro contábil. PIS/COFINS em geral não cumulativo.',
  },
];

/** Situação tributária PIS/COFINS (TipLan / ABRASF Americana). */
export const SITUACAO_PIS_COFINS_OPCOES: { value: string; label: string }[] = [
  { value: '00', label: '00 — Nenhuma (não informar PIS/COFINS)' },
  { value: '01', label: '01 — Operação tributável (alíquota básica)' },
  { value: '02', label: '02 — Operação tributável (alíquota diferenciada)' },
  { value: '03', label: '03 — Operação tributável (alíquota por unidade)' },
  { value: '04', label: '04 — Operação tributável monofásica' },
  { value: '05', label: '05 — Operação tributável por ST' },
  { value: '06', label: '06 — Operação tributável alíquota zero' },
  { value: '07', label: '07 — Operação isenta' },
  { value: '08', label: '08 — Operação sem incidência' },
  { value: '09', label: '09 — Operação com suspensão' },
];

export const OP_SIMP_NAC_OPCOES: { value: OpSimpNac; label: string }[] = [
  { value: 1, label: 'Não optante pelo Simples Nacional' },
  { value: 2, label: 'MEI — Microempreendedor Individual' },
  { value: 3, label: 'ME/EPP optante pelo Simples Nacional' },
  { value: 4, label: 'Optante pendente (aguardando regularização SN)' },
];

export const REG_ESP_TRIB_OPCOES = [
  { value: 0, label: 'Nenhum' },
  { value: 1, label: 'Cooperativa' },
  { value: 2, label: 'Estimativa' },
  { value: 3, label: 'Microempresa municipal' },
  { value: 4, label: 'Notário ou registrador' },
  { value: 5, label: 'Profissional autônomo' },
  { value: 6, label: 'Sociedade de profissionais' },
];

export const TRIB_ISSQN_OPCOES = [
  { value: 1, label: 'Operação tributável' },
  { value: 2, label: 'Imunidade' },
  { value: 3, label: 'Exportação de serviço' },
  { value: 4, label: 'Não incidência' },
];

export const TP_RET_ISSQN_OPCOES = [
  { value: 1, label: 'Não retido' },
  { value: 2, label: 'Retido pelo tomador' },
  { value: 3, label: 'Retido pelo intermediário' },
];

export function labelOpSimpNac(v: number): string {
  return OP_SIMP_NAC_OPCOES.find((o) => o.value === v)?.label ?? `Código ${v}`;
}

export function labelRegimeTributario(v: number): string {
  return REGIME_TRIBUTARIO_OPCOES.find((o) => o.value === v)?.label ?? `Regime ${v}`;
}

export function labelTipoApuracao(v: string | null | undefined): string {
  if (v === 'real') return 'Lucro Real';
  if (v === 'presumido') return 'Lucro Presumido';
  return '—';
}

export function isRegimeSimples(regime: number): boolean {
  return regime === 1 || regime === 2;
}

export function isRegimeNormal(regime: number): boolean {
  return regime === 3;
}

/** Ao mudar o CRT, alinha a flag NFS-e de optante do Simples. */
export function opSimpNacParaRegime(regime: RegimeTributario, atual?: number): OpSimpNac {
  if (regime === 3) return 1;
  if (atual === 2 || atual === 3 || atual === 4) return atual as OpSimpNac;
  return 3;
}

/** Defaults fiscais ao entrar em Regime Normal. */
export function defaultsRegimeNormal(apuracao: TipoApuracaoNormal = 'presumido') {
  return {
    regime_tributario: 3 as RegimeTributario,
    op_simp_nac: 1 as OpSimpNac,
    tipo_apuracao: apuracao,
    /** TipLan: 00 = sem PIS/COFINS no RPS (comum em serviços municipais). */
    situacao_pis_cofins: '00',
    aliquota_iss: 0,
    aliquota_pis: apuracao === 'presumido' ? 0.65 : 1.65,
    aliquota_cofins: apuracao === 'presumido' ? 3 : 7.6,
    cst_icms: '00',
    csosn: '',
  };
}

export function regimeCurto(regime: number, tipoApuracao?: string | null): string {
  if (regime === 3) {
    if (tipoApuracao === 'real') return 'Normal · Real';
    if (tipoApuracao === 'presumido') return 'Normal · Presumido';
    return 'Normal';
  }
  if (regime === 2) return 'SN excesso';
  return 'Simples';
}
