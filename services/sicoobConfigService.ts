import { supabase } from '@/lib/supabase';
import type { SicoobConfig, SicoobConfigInput } from '@/types/sicoob';

/** App de produção liberado na cooperativa 5004 (CNPJ 05.320.214/0001-69). */
export const SICOOB_PROD_DEFAULTS = {
  client_id: '65892082-96c4-46d3-8033-fa7e87d14a59',
  numero_cliente: 1347780,
  numero_conta_corrente: 10196269,
} as const;

const DEMO_CLIENT_ID = '9b5e603e428cc477a2841e2683c92d21';

const DEFAULT: SicoobConfigInput = {
  ativo: true,
  ambiente: 'producao',
  client_id: SICOOB_PROD_DEFAULTS.client_id,
  numero_cliente: SICOOB_PROD_DEFAULTS.numero_cliente,
  numero_conta_corrente: SICOOB_PROD_DEFAULTS.numero_conta_corrente,
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

function precisaProducao(cfg: SicoobConfig): boolean {
  const client = cfg.client_id?.trim() ?? '';
  if (!client || client === DEMO_CLIENT_ID) return true;
  if (cfg.ambiente !== 'producao') return true;
  if (!cfg.numero_cliente || !cfg.numero_conta_corrente) return true;
  return false;
}

export async function ensureSicoobConfig(userId: string): Promise<SicoobConfig> {
  const existing = await fetchSicoobConfig(userId);
  if (existing && !precisaProducao(existing)) return existing;

  const base = existing ?? null;
  await upsertSicoobConfig(userId, {
    ativo: true,
    ambiente: 'producao',
    client_id:
      base?.client_id?.trim() && base.client_id.trim() !== DEMO_CLIENT_ID
        ? base.client_id.trim()
        : SICOOB_PROD_DEFAULTS.client_id,
    numero_cliente: base?.numero_cliente || SICOOB_PROD_DEFAULTS.numero_cliente,
    numero_conta_corrente: base?.numero_conta_corrente || SICOOB_PROD_DEFAULTS.numero_conta_corrente,
    codigo_modalidade: base?.codigo_modalidade || DEFAULT.codigo_modalidade,
    codigo_especie_documento: base?.codigo_especie_documento || DEFAULT.codigo_especie_documento,
    identificacao_emissao_boleto: base?.identificacao_emissao_boleto || DEFAULT.identificacao_emissao_boleto,
    identificacao_distribuicao_boleto:
      base?.identificacao_distribuicao_boleto || DEFAULT.identificacao_distribuicao_boleto,
    gerar_pix_boleto: base?.gerar_pix_boleto ?? DEFAULT.gerar_pix_boleto,
    webhook_token: base?.webhook_token ?? null,
  });
  const created = await fetchSicoobConfig(userId);
  if (!created) throw new Error('Não foi possível criar configuração Sicoob.');
  return created;
}

export function sicoobConfigDefaults(): SicoobConfigInput {
  return { ...DEFAULT };
}
