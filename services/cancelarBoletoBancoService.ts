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

/** Altera o vencimento no sistema e, se o boleto já está registrado, também no Sicoob ou no C6. */
export async function alterarVencimentoBoleto(
  boletoId: string,
  dataVencimento: string,
): Promise<{ message: string; banco: string | null; dataVencimento: string }> {
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
    body: JSON.stringify({ action: 'alterar-vencimento', boletoId, dataVencimento }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    banco?: string | null;
    dataVencimento?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.message ?? `Não foi possível alterar o vencimento (${res.status}).`);
  }

  return {
    message: body.message ?? 'Vencimento alterado.',
    banco: body.banco ?? null,
    dataVencimento: body.dataVencimento ?? dataVencimento,
  };
}
