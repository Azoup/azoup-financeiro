import { supabase } from '@/lib/supabase';
import { boletoApiBaseUrl } from '@/services/sicoobBoletoService';

/** Cancela/baixa boletos registrados na API do banco (C6 ou Sicoob). */
export async function cancelarBoletosNoBanco(boletoIds: string[]): Promise<{
  success: boolean;
  erros: string[];
  resultados: Array<Record<string, unknown>>;
}> {
  if (!boletoIds.length) return { success: true, erros: [], resultados: [] };

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
    body: JSON.stringify({ action: 'cancelar-boletos', boletoIds }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    erros?: string[];
    resultados?: Array<Record<string, unknown>>;
  };

  if (!res.ok) {
    throw new Error(
      body.message ?? body.erros?.join(' · ') ?? `Cancelamento no banco falhou (${res.status}).`,
    );
  }

  return {
    success: body.success !== false,
    erros: body.erros ?? [],
    resultados: body.resultados ?? [],
  };
}
