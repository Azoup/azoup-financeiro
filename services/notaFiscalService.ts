import { supabase } from '@/lib/supabase';
import { ensureNfeConfig, fetchCertificadoAtivo, nfeApiBaseUrl } from '@/services/nfeConfigService';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import { vincularNotaFiscalAoBoletoMensalidade } from '@/services/sicoobBoletoService';
import type { CancelarNfeResult, EmitirNfeResult, NotaFiscalListRow } from '@/types/notaFiscal';
import { AMBIENTE_FISCAL_HOMOLOGACAO } from '@/types/notaFiscal';
import { CLIENTE_EMBED_SELECT, mapClienteEnderecoFiscal, mapClienteJoinEmbed } from '@/utils/clientesDbMapping';

type MensalidadeNfInput = {
  id: string;
  cliente_id: string;
  valor: number;
  competencia: string | null;
};

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

function descricaoItem(competencia: string | null, padrao: string): string {
  const comp = competencia?.trim();
  return comp ? `${padrao} — competência ${comp}` : padrao;
}

export async function fetchNotasFiscaisLista(userId: string): Promise<NotaFiscalListRow[]> {
  const { data, error } = await supabase
    .from('nota_fiscal')
    .select('*, clientes(nome_fantasia, nome)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data as (NotaFiscalListRow & { clientes?: { nome_fantasia?: string; nome?: string } | null })[] | null) ?? []).map(
    (row) => {
      const { clientes, ...rest } = row;
      return { ...rest, cliente: mapClienteJoinEmbed(clientes) };
    },
  );
}

export async function criarNotaFiscalRascunhoMensalidade(
  userId: string,
  mensalidade: MensalidadeNfInput,
): Promise<string> {
  const [config, perfil, clienteRes] = await Promise.all([
    ensureNfeConfig(userId),
    fetchPerfilCobranca(userId),
    supabase
      .from('clientes')
      .select(CLIENTE_EMBED_SELECT)
      .eq('id', mensalidade.cliente_id)
      .single(),
  ]);

  if (clienteRes.error || !clienteRes.data) {
    throw new Error(clienteRes.error?.message ?? 'Cliente não encontrado.');
  }
  const clienteRow = mapClienteEnderecoFiscal(clienteRes.data as Parameters<typeof mapClienteEnderecoFiscal>[0]);
  if (!clienteRow.emite_nf) {
    throw new Error(`Cliente "${clienteRow.nome_cliente}" está marcado como Sem NF no cadastro.`);
  }
  if (!perfil?.razao_social?.trim() || !onlyDigits(perfil.documento).length) {
    throw new Error('Preencha os dados do beneficiário em Configurações antes de emitir NFS-e.');
  }
  if (!config.codigo_ibge_emitente?.trim()) {
    throw new Error('Informe o código IBGE do município do prestador em Configurações › NFS-e.');
  }
  if (!config.codigo_tributacao_nacional?.trim()) {
    throw new Error('Informe o código de tributação nacional do serviço em Configurações › NFS-e.');
  }

  const numero = config.proximo_numero;
  const descricao = descricaoItem(mensalidade.competencia, config.descricao_servico_padrao);

  const { data: nf, error: nfErr } = await supabase
    .from('nota_fiscal')
    .insert({
      user_id: userId,
      mensalidade_id: mensalidade.id,
      cliente_id: mensalidade.cliente_id,
      serie: config.serie,
      numero,
      status: 'rascunho',
      valor_total: mensalidade.valor,
      natureza_operacao: config.natureza_operacao,
      ambiente: AMBIENTE_FISCAL_HOMOLOGACAO,
      tipo_documento: 'nfse',
      competencia: mensalidade.competencia,
    })
    .select('id')
    .single();
  if (nfErr || !nf) throw new Error(nfErr?.message ?? 'Falha ao criar rascunho da NFS-e.');

  const notaId = nf.id as string;

  const { error: itemErr } = await supabase.from('nota_fiscal_item').insert({
    nota_fiscal_id: notaId,
    numero_item: 1,
    descricao,
    ncm: config.codigo_tributacao_nacional,
    cfop: config.codigo_nbs,
    unidade: 'UN',
    quantidade: 1,
    valor_unitario: mensalidade.valor,
    valor_total: mensalidade.valor,
    cst_icms: config.cst_icms,
    csosn: config.csosn,
    perc_icms: 0,
  });
  if (itemErr) {
    await supabase.from('nota_fiscal').delete().eq('id', notaId);
    throw new Error(itemErr.message);
  }

  const { error: pagErr } = await supabase.from('nota_fiscal_pagamento').insert({
    nota_fiscal_id: notaId,
    forma_pagamento: '99',
    valor: mensalidade.valor,
  });
  if (pagErr) {
    await supabase.from('nota_fiscal').delete().eq('id', notaId);
    throw new Error(pagErr.message);
  }

  await supabase
    .from('nfe_config')
    .update({ proximo_numero: numero + 1 })
    .eq('user_id', userId);

  return notaId;
}

export async function emitirNotaFiscalSefaz(notaFiscalId: string): Promise<EmitirNfeResult> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = nfeApiBaseUrl();
  if (!base) {
    throw new Error('URL da API NFS-e não configurada (EXPO_PUBLIC_NFE_API_URL ou origem web).');
  }

  await supabase.from('nota_fiscal').update({ status: 'processando' }).eq('id', notaFiscalId);

  const res = await fetch(`${base}/api/nfe/emitir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ notaFiscalId }),
  });

  const body = (await res.json().catch(() => ({}))) as EmitirNfeResult & { error?: string };

  if (!res.ok || !body.success) {
    const msg = body.message ?? body.error ?? `Emissão falhou (${res.status}).`;
    await supabase
      .from('nota_fiscal')
      .update({ status: 'rejeitada', motivo_rejeicao: msg, status_sefaz: body.status ?? null })
      .eq('id', notaFiscalId);
    return { success: false, message: msg, status: body.status };
  }

  const { data: notaRow } = await supabase
    .from('nota_fiscal')
    .select('mensalidade_id')
    .eq('id', notaFiscalId)
    .maybeSingle();
  if (notaRow?.mensalidade_id) {
    await vincularNotaFiscalAoBoletoMensalidade(notaRow.mensalidade_id, notaFiscalId).catch(() => undefined);
  }

  return body;
}

export async function cancelarNotaFiscalSefaz(
  notaFiscalId: string,
  justificativa: string,
): Promise<CancelarNfeResult> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const just = justificativa.trim();
  if (just.length < 15) {
    throw new Error('Informe o motivo do cancelamento com no mínimo 15 caracteres.');
  }

  const base = nfeApiBaseUrl();
  if (!base) {
    throw new Error('URL da API NFS-e não configurada.');
  }

  const res = await fetch(`${base}/api/nfe/cancelar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ notaFiscalId, justificativa: just }),
  });

  const body = (await res.json().catch(() => ({}))) as CancelarNfeResult & { error?: string };

  if (!res.ok || !body.success) {
    throw new Error(body.message ?? body.error ?? `Cancelamento falhou (${res.status}).`);
  }

  return body;
}

export async function gerarNotasFiscaisParaMensalidades(
  userId: string,
  mensalidades: MensalidadeNfInput[],
): Promise<{ emitidas: number; rejeitadas: number; ignoradas: number; erros: string[] }> {
  const cert = await fetchCertificadoAtivo(userId);
  if (!cert) {
    throw new Error('Cadastre o certificado A1 em Configurações › NFS-e antes de gerar notas fiscais.');
  }

  let emitidas = 0;
  let rejeitadas = 0;
  let ignoradas = 0;
  const erros: string[] = [];

  for (const m of mensalidades) {
    try {
      const notaId = await criarNotaFiscalRascunhoMensalidade(userId, m);
      const res = await emitirNotaFiscalSefaz(notaId);
      if (res.success) emitidas += 1;
      else {
        rejeitadas += 1;
        erros.push(res.message ?? `NF rejeitada (mensalidade ${m.id})`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (/Sem NF/i.test(msg)) {
        ignoradas += 1;
      } else {
        rejeitadas += 1;
        erros.push(msg);
      }
    }
  }

  return { emitidas, rejeitadas, ignoradas, erros };
}
