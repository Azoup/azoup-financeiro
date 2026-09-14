import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import type { AzoupFaturaResumo, AzoupFaturasData } from '@/types/azoupAdmin';

export type FetchAzoupFaturasParams = {
  from: string;
  to: string;
  status?: string;
};

async function marcarNfseEmitidas(faturas: AzoupFaturaResumo[]): Promise<AzoupFaturaResumo[]> {
  if (!faturas.length) return faturas;
  try {
    const { data, error } = await supabase
      .from('nota_fiscal_item')
      .select('descricao, nota_fiscal_id, nota_fiscal:nota_fiscal_id(id, status)')
      .ilike('descricao', '%stripe_invoice:%')
      .limit(5000);
    if (error || !data?.length) {
      return faturas.map((f) => ({
        ...f,
        nfse_emitida: false,
        nota_fiscal_id: null,
      }));
    }

    const map = new Map<string, string>();
    for (const row of data) {
      const desc = `${(row as { descricao?: string }).descricao ?? ''}`;
      const m = desc.match(/stripe_invoice:([A-Za-z0-9_]+)/);
      if (!m?.[1]) continue;
      const nfRaw = (row as { nota_fiscal?: { id?: string; status?: string } | { id?: string; status?: string }[] })
        .nota_fiscal;
      const nf = Array.isArray(nfRaw) ? nfRaw[0] : nfRaw;
      const status = `${nf?.status ?? ''}`.toLowerCase();
      if (!['autorizada', 'processando', 'rascunho'].includes(status)) continue;
      const notaId = nf?.id || (row as { nota_fiscal_id?: string }).nota_fiscal_id;
      if (notaId) map.set(m[1], notaId);
    }

    return faturas.map((f) => {
      const notaId = map.get(f.stripe_invoice_id) ?? null;
      const emitida = Boolean(notaId);
      return {
        ...f,
        nfse_emitida: emitida,
        nota_fiscal_id: notaId,
        pode_emitir_nf: Boolean(f.pode_emitir_nf) && !emitida,
      };
    });
  } catch {
    return faturas.map((f) => ({
      ...f,
      nfse_emitida: false,
      nota_fiscal_id: null,
    }));
  }
}

export async function fetchAzoupFaturas(params: FetchAzoupFaturasParams): Promise<AzoupFaturasData> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = nfeApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const qs = new URLSearchParams({
    resource: 'faturas',
    from: params.from,
    to: params.to,
    status: params.status ?? 'pago',
  });

  const res = await fetch(`${base}/api/externo/azoup-dashboard?${qs.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const body = (await res.json().catch(() => ({}))) as AzoupFaturasData & {
    success?: boolean;
    message?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.message ?? `Falha ao carregar faturas (${res.status}).`);
  }

  const faturas = await marcarNfseEmitidas(
    (body.faturas ?? []).map((f) => ({
      ...f,
      valor_centavos: f.valor_centavos ?? 0,
      pode_emitir_nf: Boolean(f.pode_emitir_nf),
      nfse_emitida: false,
      nota_fiscal_id: null,
    })),
  );

  return {
    gerado_em: body.gerado_em,
    from: body.from ?? params.from,
    to: body.to ?? params.to,
    total: body.total ?? faturas.length,
    faturas,
  };
}
