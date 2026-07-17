import { supabase } from '@/lib/supabase';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import type { AzoupDashboardData } from '@/types/azoupAdmin';

export async function fetchAzoupDashboard(): Promise<AzoupDashboardData> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = nfeApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const res = await fetch(`${base}/api/externo/azoup-dashboard`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const body = (await res.json().catch(() => ({}))) as AzoupDashboardData & {
    success?: boolean;
    message?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.message ?? `Falha ao carregar painel Azoup (${res.status}).`);
  }

  return {
    gerado_em: body.gerado_em,
    mrr_fonte: body.mrr_fonte ?? 'local',
    total_clientes: body.total_clientes ?? 0,
    clientes_assinatura_ativa: body.clientes_assinatura_ativa ?? 0,
    clientes_trial: body.clientes_trial ?? 0,
    clientes_inadimplentes: body.clientes_inadimplentes ?? 0,
    clientes_cancelados: body.clientes_cancelados ?? 0,
    mrr_centavos: body.mrr_centavos ?? 0,
    mrr_bruto_centavos: body.mrr_bruto_centavos ?? 0,
    desconto_centavos: body.desconto_centavos ?? 0,
    assinaturas_com_desconto: body.assinaturas_com_desconto ?? 0,
    planos_clientes: body.planos_clientes ?? [],
    clientes: body.clientes ?? [],
  };
}
