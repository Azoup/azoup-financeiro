import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import { ensureC6Config } from '@/services/c6ConfigService';
import type { EmitirBoletoC6Result } from '@/types/c6';
import type { EmitirBoletoLoteResult } from '@/types/sicoob';

export function boletoApiBaseUrl(): string {
  return nfeApiBaseUrl();
}

export async function emitirBoletosC6Lote(
  userId: string,
  emitenteId: string,
  boletoIds: string[],
  opts?: { modoRapido?: boolean },
): Promise<EmitirBoletoLoteResult> {
  if (!boletoIds.length) {
    return { success: true, emitidos: 0, erros: [], resultados: [] };
  }

  const config = await ensureC6Config(userId, emitenteId);
  if (!config.ativo) {
    throw new Error(
      'Integração C6 inativa em Configurações › Boleto C6. Ative para registrar boleto real.',
    );
  }

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = boletoApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const modoRapido = opts?.modoRapido !== false;
  const erros: string[] = [];
  const resultados: EmitirBoletoC6Result[] = [];
  let emitidos = 0;

  // Um boleto por requisição evita 504 (timeout 60s) na Vercel.
  for (const boletoId of boletoIds) {
    const res = await fetch(`${base}/api/boleto/emitir-lote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        boletoIds: [boletoId],
        emitenteId,
        banco: 'c6',
        modoRapido,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as EmitirBoletoLoteResult & {
      message?: string;
      resultados?: EmitirBoletoC6Result[];
    };

    if (res.status === 504) {
      erros.push(
        `${boletoId}: Tempo esgotado (504) ao registrar no C6. Use “Registrar no C6” na mensalidade.`,
      );
      continue;
    }

    if (!res.ok) {
      erros.push(body.message ?? body.erros?.join(' · ') ?? `Emissão C6 falhou (${res.status}).`);
      continue;
    }

    if (body.erros?.length) {
      erros.push(...body.erros);
    }
    if (body.resultados?.length) {
      resultados.push(...body.resultados);
    }
    emitidos += body.emitidos ?? 0;
  }

  if (erros.length && emitidos === 0) {
    throw new Error(erros.join('\n'));
  }

  return {
    success: erros.length === 0,
    emitidos,
    erros,
    resultados,
  };
}

/** Reenvia boleto(s) para registro real no C6 (erro / sem PDF) — completo com PDF e Pix. */
export async function reemitirBoletosC6(
  userId: string,
  emitenteId: string,
  boletoIds: string[],
): Promise<EmitirBoletoLoteResult> {
  return emitirBoletosC6Lote(userId, emitenteId, boletoIds, { modoRapido: false });
}
