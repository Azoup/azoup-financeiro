export type OpSimpNac = 1 | 2 | 3 | 4;

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
