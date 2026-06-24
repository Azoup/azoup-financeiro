import { supabase } from '@/lib/supabase';
import type { SicoobConfig, SicoobConfigInput } from '@/types/sicoob';

const DEFAULT: SicoobConfigInput = {
  ativo: false,
  ambiente: 'sandbox',
  client_id: '',
  numero_cliente: 0,
  numero_conta_corrente: 0,
  codigo_modalidade: 1,
  codigo_especie_documento: 'DM',
  identificacao_emissao_boleto: 1,
  identificacao_distribuicao_boleto: 1,
  gerar_pix_boleto: false,
  webhook_token: null,
};

export async function fetchSicoobConfig(userId: string): Promise<SicoobConfig | null> {
  const { data, error } = await supabase.from('config_sicoob').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SicoobConfig | null) ?? null;
}

export async function upsertSicoobConfig(userId: string, input: SicoobConfigInput): Promise<void> {
  const row = {
    user_id: userId,
    ativo: input.ativo,
    ambiente: input.ambiente,
    client_id: input.client_id.trim(),
    numero_cliente: Number(input.numero_cliente) || 0,
    numero_conta_corrente: Number(input.numero_conta_corrente) || 0,
    codigo_modalidade: Number(input.codigo_modalidade) || 1,
    codigo_especie_documento: input.codigo_especie_documento.trim() || 'DM',
    identificacao_emissao_boleto: Number(input.identificacao_emissao_boleto) || 1,
    identificacao_distribuicao_boleto: Number(input.identificacao_distribuicao_boleto) || 1,
    gerar_pix_boleto: Boolean(input.gerar_pix_boleto),
    webhook_token: input.webhook_token?.trim() || null,
  };
  const { error } = await supabase.from('config_sicoob').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function ensureSicoobConfig(userId: string): Promise<SicoobConfig> {
  const existing = await fetchSicoobConfig(userId);
  if (existing) return existing;
  await upsertSicoobConfig(userId, DEFAULT);
  const created = await fetchSicoobConfig(userId);
  if (!created) throw new Error('Não foi possível criar configuração Sicoob.');
  return created;
}

export function sicoobConfigDefaults(): SicoobConfigInput {
  return { ...DEFAULT };
}
