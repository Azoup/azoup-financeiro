import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import { ensureSicoobConfig, upsertSicoobConfig } from '@/services/sicoobConfigService';
import type { EmitirBoletoLoteResult } from '@/types/sicoob';

export function boletoApiBaseUrl(): string {
  return nfeApiBaseUrl();
}

export async function emitirBoletosSicoobLote(
  userId: string,
  boletoIds: string[],
  opts?: { exigirRegistro?: boolean },
): Promise<EmitirBoletoLoteResult> {
  if (!boletoIds.length) {
    return { success: true, emitidos: 0, erros: [], resultados: [] };
  }

  let config = await ensureSicoobConfig(userId);
  if (!config.ativo && config.client_id?.trim() && config.numero_cliente && config.numero_conta_corrente) {
    await upsertSicoobConfig(userId, {
      ativo: true,
      ambiente: 'producao',
      client_id: config.client_id,
      numero_cliente: config.numero_cliente,
      numero_conta_corrente: config.numero_conta_corrente,
      codigo_modalidade: config.codigo_modalidade,
      codigo_especie_documento: config.codigo_especie_documento,
      identificacao_emissao_boleto: config.identificacao_emissao_boleto,
      identificacao_distribuicao_boleto: config.identificacao_distribuicao_boleto,
      gerar_pix_boleto: config.gerar_pix_boleto,
      webhook_token: config.webhook_token,
    });
    config = { ...config, ativo: true, ambiente: 'producao' };
  }
  if (!config.ativo) {
    if (opts?.exigirRegistro) {
      throw new Error(
        'Sicoob inativo. Ative e preencha Client ID / convênio em Configurações › Boleto Sicoob.',
      );
    }
    return { success: true, emitidos: 0, erros: [], resultados: [] };
  }

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = boletoApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const erros: string[] = [];
  const resultados: EmitirBoletoLoteResult['resultados'] = [];
  let emitidos = 0;
  let emailsEnviados = 0;
  let emailsIgnorados = 0;
  let emailsErro = 0;

  // Um boleto por requisição: 200+ no mesmo POST estoura o limite de 60s da Vercel (504).
  for (const boletoId of boletoIds) {
    const res = await fetch(`${base}/api/boleto/emitir-lote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ boletoIds: [boletoId] }),
    });

    const body = (await res.json().catch(() => ({}))) as EmitirBoletoLoteResult & { message?: string };

    if (res.status === 504) {
      erros.push(
        `${boletoId}: Tempo esgotado (504). O Sicoob pode já ter registrado este boleto. Não clique em Registrar de novo e não gere a mensalidade outra vez — confira no banco.`,
      );
      continue;
    }

    if (!res.ok) {
      erros.push(
        `${boletoId}: ${body.message ?? body.erros?.join(' · ') ?? `Emissão Sicoob falhou (${res.status}).`}`,
      );
      continue;
    }

    if (body.erros?.length) erros.push(...body.erros);
    if (body.resultados?.length) resultados.push(...body.resultados);
    emitidos += body.emitidos ?? 0;
    emailsEnviados += body.emails_enviados ?? 0;
    emailsIgnorados += body.emails_ignorados ?? 0;
    emailsErro += body.emails_erro ?? 0;
  }

  if (erros.length && emitidos === 0) {
    throw new Error(erros.join('\n'));
  }

  return {
    success: erros.length === 0,
    emitidos,
    erros,
    resultados,
    emails_enviados: emailsEnviados,
    emails_ignorados: emailsIgnorados,
    emails_erro: emailsErro,
  };
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

export async function vincularNotaFiscalAoBoletoVenda(
  vendaId: string,
  notaFiscalId: string,
): Promise<void> {
  const { error } = await supabase
    .from('boletos_parcela_venda')
    .update({ nota_fiscal_id: notaFiscalId })
    .eq('venda_id', vendaId);
  if (error) throw new Error(error.message);
}

export async function reemitirBoletosSicoob(userId: string, boletoIds: string[]): Promise<EmitirBoletoLoteResult> {
  return emitirBoletosSicoobLote(userId, boletoIds, { exigirRegistro: true });
}

export async function sincronizarBoletosPendentes(rodada = 0): Promise<{
  consultados: number;
  baixados: number;
  temMais: boolean;
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
    body: JSON.stringify({ rodada }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    consultados?: number;
    baixados?: number;
    temMais?: boolean;
    resultados?: Array<Record<string, unknown>>;
    message?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.message ?? `Sincronização falhou (${res.status}).`);
  }

  return {
    consultados: body.consultados ?? 0,
    baixados: body.baixados ?? 0,
    temMais: Boolean(body.temMais),
    resultados: body.resultados ?? [],
  };
}

