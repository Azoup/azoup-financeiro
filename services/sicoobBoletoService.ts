import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import { fetchSicoobConfig } from '@/services/sicoobConfigService';
import type { EmitirBoletoLoteResult } from '@/types/sicoob';

export function boletoApiBaseUrl(): string {
  return nfeApiBaseUrl();
}

export async function emitirBoletosSicoobLote(userId: string, boletoIds: string[]): Promise<EmitirBoletoLoteResult> {
  if (!boletoIds.length) {
    return { success: true, emitidos: 0, erros: [], resultados: [] };
  }

  const config = await fetchSicoobConfig(userId);
  if (!config?.ativo) {
    return { success: true, emitidos: 0, erros: [], resultados: [] };
  }

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = boletoApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const res = await fetch(`${base}/api/boleto/emitir-lote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ boletoIds }),
  });

  const body = (await res.json().catch(() => ({}))) as EmitirBoletoLoteResult & { message?: string };
  if (!res.ok) {
    throw new Error(body.message ?? body.erros?.join(' · ') ?? `Emissão Sicoob falhou (${res.status}).`);
  }

  if (body.erros?.length) {
    throw new Error(body.erros.join('\n'));
  }

  return body;
}

export async function vincularNotaFiscalAoBoletoMensalidade(
  mensalidadeId: string,
  notaFiscalId: string,
): Promise<void> {
  const { error } = await supabase
    .from('boletos_parcela_venda')
    .update({ nota_fiscal_id: notaFiscalId })
    .eq('mensalidade_id', mensalidadeId);
  if (error) throw new Error(error.message);
}

export async function sincronizarBoletosPendentes(): Promise<{
  consultados: number;
  baixados: number;
  resultados: Array<Record<string, unknown>>;
}> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = boletoApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada.');
  }

  const res = await fetch(`${base}/api/boleto/sincronizar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    consultados?: number;
    baixados?: number;
    resultados?: Array<Record<string, unknown>>;
    message?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.message ?? `Sincronização falhou (${res.status}).`);
  }

  return {
    consultados: body.consultados ?? 0,
    baixados: body.baixados ?? 0,
    resultados: body.resultados ?? [],
  };
}
