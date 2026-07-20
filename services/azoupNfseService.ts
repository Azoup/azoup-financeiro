import { supabase } from '@/lib/supabase';
import { createCliente } from '@/services/clientsService';
import { nfeApiBaseUrl } from '@/services/nfeConfigService';
import { gerarNotaFiscalAvulsa } from '@/services/notaFiscalService';
import type { AzoupClienteNfPayload } from '@/types/azoupAdmin';
import type { ClienteFormValues } from '@/types/models';
import { formatBRL } from '@/utils/currency';

const AZOUP_OBS_PREFIX = 'azoup_cliente_id:';

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

function maskCnpj(digits: string): string {
  const d = onlyDigits(digits).slice(0, 14);
  if (d.length !== 14) return d;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

export async function fetchAzoupClienteParaNf(azoupClienteId: string): Promise<AzoupClienteNfPayload> {
  const base = nfeApiBaseUrl();
  if (!base) {
    throw new Error('URL da API não configurada (use a mesma origem web ou EXPO_PUBLIC_NFE_API_URL).');
  }

  const res = await fetch(
    `${base}/api/externo/azoup-cliente?id=${encodeURIComponent(azoupClienteId)}`,
    { method: 'GET', headers: await authHeaders() },
  );
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    cliente?: AzoupClienteNfPayload;
  };
  if (!res.ok || body.success === false || !body.cliente) {
    throw new Error(body.message ?? `Falha ao carregar cliente Azoup (${res.status}).`);
  }
  return body.cliente;
}

async function findLocalClienteId(
  userId: string,
  azoupId: string,
  cnpjDigits: string,
): Promise<string | null> {
  if (cnpjDigits.length === 14) {
    const { data, error } = await supabase
      .from('clientes')
      .select('id')
      .eq('user_id', userId)
      .eq('cnpj', cnpjDigits)
      .maybeSingle();
    if (!error && data?.id) return data.id as string;

    const masked = maskCnpj(cnpjDigits);
    const { data: data2, error: e2 } = await supabase
      .from('clientes')
      .select('id')
      .eq('user_id', userId)
      .eq('cnpj', masked)
      .maybeSingle();
    if (!e2 && data2?.id) return data2.id as string;
  }

  const { data: byObs, error: obsErr } = await supabase
    .from('clientes')
    .select('id, observacao')
    .eq('user_id', userId)
    .ilike('observacao', `%${AZOUP_OBS_PREFIX}${azoupId}%`)
    .limit(1);
  if (!obsErr && byObs?.[0]?.id) return byObs[0].id as string;

  return null;
}

function buildFormFromAzoup(
  payload: AzoupClienteNfPayload,
  valorReais: number,
): ClienteFormValues {
  const end = payload.endereco ?? {
    cep: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
  };
  const cnpj = onlyDigits(payload.empresa_matriz_cnpj ?? '');
  const nomeFantasia =
    payload.empresa_matriz_nome?.trim() || payload.nome?.trim() || 'Cliente Azoup';
  const razao =
    payload.empresa_matriz_razao?.trim() ||
    payload.empresa_matriz_nome?.trim() ||
    payload.nome?.trim() ||
    'Cliente Azoup';

  return {
    documento: '',
    cnpj: cnpj.length === 14 ? maskCnpj(cnpj) : cnpj,
    inscricao_estadual: '',
    nome_cliente: nomeFantasia,
    nome_empresa: razao,
    mes_entrada: '',
    valor_mensalidade_anterior: '',
    valor_mensalidade: formatBRL(valorReais),
    segmento_cliente_codigo: 'DIVERSOS',
    dia_vencimento: '',
    data_reajuste: null,
    ultimo_reajuste: null,
    observacao: `${AZOUP_OBS_PREFIX}${payload.id}`,
    contatos: payload.email
      ? [{ nome_contato: 'Principal', tipo_contato: 'email', valor_contato: payload.email }]
      : [],
    cep: end.cep ?? '',
    logradouro: end.logradouro ?? '',
    numero: end.numero ?? '',
    complemento: end.complemento ?? '',
    bairro: end.bairro ?? '',
    cidade: end.cidade ?? '',
    uf: end.uf ?? '',
    pdfPath: null,
    pdfLocalUri: null,
    pdfFileName: null,
    cancelado: false,
    cancelamento_justificativa: '',
    emite_nf: true,
    tipo_faturamento: 'mensal',
    parcelas_anuais: '12',
  };
}

/**
 * Garante cliente local (SistemaJessica) espelhando a empresa matriz Azoup.
 * Retorna id do cliente local.
 */
export async function ensureLocalClienteFromAzoup(
  userId: string,
  payload: AzoupClienteNfPayload,
): Promise<{ clienteId: string; criado: boolean }> {
  const cnpj = onlyDigits(payload.empresa_matriz_cnpj ?? '');
  if (cnpj.length !== 14) {
    throw new Error(
      'Cliente Azoup sem CNPJ da empresa matriz. Cadastre a matriz no Azoup antes de emitir NFS-e.',
    );
  }

  const valorReais =
    (payload.valor_centavos > 0 ? payload.valor_centavos : payload.valor_bruto_centavos) / 100;
  const form = buildFormFromAzoup(payload, valorReais || 0.01);

  const existingId = await findLocalClienteId(userId, payload.id, cnpj);
  if (existingId) {
    const end = payload.endereco;
    const patch: Record<string, unknown> = {
      cnpj: maskCnpj(cnpj),
      nome_fantasia: form.nome_cliente,
      nome: form.nome_empresa || null,
      mensalidade: valorReais || 0.01,
      emite_nf: true,
      observacao: form.observacao,
    };
    if (end?.cep) patch.cep = end.cep;
    if (end?.logradouro) patch.logradouro = end.logradouro;
    if (end?.numero) patch.numero = end.numero;
    if (end?.complemento) patch.complemento = end.complemento;
    if (end?.bairro) patch.bairro = end.bairro;
    if (end?.cidade) patch.cidade = end.cidade;
    if (end?.uf) patch.estado = end.uf;

    const { error } = await supabase.from('clientes').update(patch).eq('id', existingId).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { clienteId: existingId, criado: false };
  }

  const { id } = await createCliente(userId, form);
  return { clienteId: id, criado: true };
}

export async function emitirNfseClienteAzoup(
  userId: string,
  azoupClienteId: string,
  opts?: { emitenteId?: string | null; usarValorBruto?: boolean },
): Promise<{ success: boolean; notaId?: string; message?: string; clienteLocalId?: string }> {
  const payload = await fetchAzoupClienteParaNf(azoupClienteId);
  const { clienteId } = await ensureLocalClienteFromAzoup(userId, payload);

  const centavos = opts?.usarValorBruto
    ? payload.valor_bruto_centavos || payload.valor_centavos
    : payload.valor_centavos || payload.valor_bruto_centavos;
  if (!centavos || centavos <= 0) {
    throw new Error('Assinatura sem valor para emitir NFS-e.');
  }

  const agora = new Date();
  const competencia = `${agora.getFullYear()}-${`${agora.getMonth() + 1}`.padStart(2, '0')}`;
  const descricao = `Assinatura Azoup — ${payload.plano_id ? `plano ${payload.plano_id}` : payload.nome} — ${competencia}`;

  const res = await gerarNotaFiscalAvulsa(
    userId,
    {
      cliente_id: clienteId,
      valor: centavos / 100,
      descricao,
      competencia,
    },
    { emitenteId: opts?.emitenteId },
  );

  return { ...res, clienteLocalId: clienteId };
}
