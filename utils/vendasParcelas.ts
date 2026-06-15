/** Soma em centavos (inteiro) para evitar erro de ponto flutuante. */
export function reaisParaCentavos(v: number): number {
  return Math.round((Number(v) || 0) * 100);
}

export function centavosParaReais(c: number): number {
  return Math.round(c) / 100;
}

export function addDias(data: Date, dias: number): Date {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  d.setDate(d.getDate() + dias);
  return d;
}

/** Divide total em centavos em n parcelas; resto vai para as primeiras. */
export function dividirTotalCentavos(totalCentavos: number, n: number): number[] {
  if (n <= 0 || totalCentavos < 0) return [];
  const base = Math.floor(totalCentavos / n);
  const resto = totalCentavos % n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(base + (i < resto ? 1 : 0));
  }
  return out;
}

export type ParcelaPreview = {
  tempId: string;
  grupoIndex: number;
  numeroGlobal: number;
  valorCentavos: number;
  vencimento: Date;
  formaPagamentoId: string;
};

export function gerarPreviewParcelas(params: {
  grupoIndex: number;
  numeroInicialGlobal: number;
  valorGrupoCentavos: number;
  qtdParcelas: number;
  intervaloDias: number;
  dataPrimeira: Date;
  formaPagamentoId: string;
}): ParcelaPreview[] {
  const partes = dividirTotalCentavos(params.valorGrupoCentavos, params.qtdParcelas);
  const out: ParcelaPreview[] = [];
  for (let i = 0; i < partes.length; i++) {
    out.push({
      tempId: `g${params.grupoIndex}-p${i}-${Math.random().toString(36).slice(2, 9)}`,
      grupoIndex: params.grupoIndex,
      numeroGlobal: params.numeroInicialGlobal + i,
      valorCentavos: partes[i],
      vencimento: addDias(params.dataPrimeira, params.intervaloDias * i),
      formaPagamentoId: params.formaPagamentoId,
    });
  }
  return out;
}

/** Após editar o valor (centavos) de uma parcela do grupo, redistribui o restante nas outras do mesmo grupo. */
export function rebalancearGrupo(
  parcelas: ParcelaPreview[],
  tempIdEditado: string,
  novoValorCentavos: number,
): ParcelaPreview[] {
  const alvo = parcelas.find((p) => p.tempId === tempIdEditado);
  if (!alvo) return parcelas;
  const gIdx = alvo.grupoIndex;
  const doGrupo = parcelas.filter((p) => p.grupoIndex === gIdx).sort((a, b) => a.numeroGlobal - b.numeroGlobal);
  const outros = doGrupo.filter((p) => p.tempId !== tempIdEditado);
  const totalGrupoCent = doGrupo.reduce((s, p) => s + p.valorCentavos, 0);
  const restante = totalGrupoCent - novoValorCentavos;
  if (restante < 0 || outros.length === 0) {
    return parcelas.map((p) => (p.tempId === tempIdEditado ? { ...p, valorCentavos: novoValorCentavos } : p));
  }
  const partes = dividirTotalCentavos(restante, outros.length);
  const mapa = new Map<string, number>();
  mapa.set(tempIdEditado, novoValorCentavos);
  outros.forEach((p, i) => mapa.set(p.tempId, partes[i] ?? 0));
  return parcelas.map((p) =>
    p.grupoIndex === gIdx ? { ...p, valorCentavos: mapa.get(p.tempId) ?? p.valorCentavos } : p,
  );
}
