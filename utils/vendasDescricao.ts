/** Persistência: um item → só `descricao`; vários → `itens_descricao` + `descricao` com quebras de linha. */
export function serializeVendaDescricaoItens(raw: string[]): {
  descricao: string;
  itens_descricao: string[] | null;
} {
  const parts = raw.map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Informe a descrição da venda.');
  }
  if (parts.length === 1) {
    return { descricao: parts[0], itens_descricao: null };
  }
  return { descricao: parts.join('\n'), itens_descricao: parts };
}

export function vendaDescricaoLinhas(v: { descricao: string; itens_descricao?: unknown }): string[] {
  const raw = v.itens_descricao;
  if (Array.isArray(raw) && raw.length > 1) {
    return raw
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const d = (v.descricao ?? '').trim();
  return d ? [d] : [];
}

/** Texto curto para lista (vários itens viram “a · b (+n)”). */
export function vendaDescricaoResumo(
  v: { descricao: string; itens_descricao?: unknown },
  maxPartes = 2,
): string {
  const lines = vendaDescricaoLinhas(v);
  if (lines.length <= 1) return lines[0] ?? '';
  const shown = lines.slice(0, maxPartes).join(' · ');
  const rest = lines.length - maxPartes;
  return rest > 0 ? `${shown} (+${rest})` : shown;
}
