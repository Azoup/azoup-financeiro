import { supabase } from '@/lib/supabase';
import { ensureNfeConfig, fetchCertificadoAtivo, nfeApiBaseUrl } from '@/services/nfeConfigService';
import {
  fetchCertificadoAtivoEmitente,
  fetchEmitenteById,
  fetchEmitentePadrao,
  ensureEmitentes,
} from '@/services/nfseEmitenteService';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import { vincularNotaFiscalAoBoletoMensalidade, vincularNotaFiscalAoBoletoVenda } from '@/services/sicoobBoletoService';
import type {
  CancelarNfeResult,
  EmitirNfeResult,
  NfseEmitente,
  NotaFiscalListRow,
} from '@/types/notaFiscal';
import { AMBIENTE_FISCAL_ATUAL } from '@/types/notaFiscal';
import { CLIENTE_EMBED_SELECT, mapClienteEnderecoFiscal, mapClienteJoinEmbed } from '@/utils/clientesDbMapping';

type MensalidadeNfInput = {
  id: string;
  cliente_id: string;
  valor: number;
  competencia: string | null;
};

type VendaNfInput = {
  id: string;
  cliente_id: string;
  valor_total: number;
  descricao: string;
};

type EmitOpts = { emitenteId?: string | null };

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

function descricaoItem(competencia: string | null, padrao: string): string {
  const comp = competencia?.trim();
  return comp ? `${padrao} — competência ${comp}` : padrao;
}

function wrapNotaFiscalInsertError(msg?: string): Error {
  if (!msg) return new Error('Falha ao criar rascunho da NFS-e.');
  if (/emitente_id|nfse_emitente/i.test(msg) && /does not exist|column|schema cache|42P01/i.test(msg)) {
    return new Error(
      'Falta a migration de emitentes. Rode supabase/migrations/037_nfse_emitente.sql no SQL Editor do Supabase.',
    );
  }
  if (/venda_id|tipo_documento|nota_fiscal|codigo_verificacao/i.test(msg) && /does not exist|column|schema cache/i.test(msg)) {
    return new Error(
      'Tabelas de NFS-e incompletas no Supabase. Execute as migrations 022_nfse_servico.sql e 030_nota_fiscal_venda.sql no SQL Editor.',
    );
  }
  return new Error(msg);
}

function mapNotaFiscalRow(
  row: NotaFiscalListRow & {
    clientes?: { nome_fantasia?: string; nome?: string } | null;
    nfse_emitente?: {
      id?: string;
      nome?: string;
      documento?: string;
      razao_social?: string;
    } | null;
  },
): NotaFiscalListRow {
  const { clientes, nfse_emitente, ...rest } = row;
  const emitente = nfse_emitente?.id
    ? {
        id: nfse_emitente.id,
        nome: nfse_emitente.nome ?? '',
        documento: nfse_emitente.documento ?? '',
        razao_social: nfse_emitente.razao_social ?? '',
      }
    : null;
  return { ...rest, cliente: mapClienteJoinEmbed(clientes), emitente };
}

export async function fetchNotasFiscaisLista(userId: string): Promise<NotaFiscalListRow[]> {
  const withJoin = await supabase
    .from('nota_fiscal')
    .select('*, clientes(nome_fantasia, nome), nfse_emitente(id, nome, documento, razao_social)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (withJoin.error) {
    // Fallback sem join de emitente (migration 037 ainda não rodada)
    const withCli = await supabase
      .from('nota_fiscal')
      .select('*, clientes(nome_fantasia, nome)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!withCli.error && withCli.data) {
      return (
        withCli.data as (NotaFiscalListRow & {
          clientes?: { nome_fantasia?: string; nome?: string } | null;
        })[]
      ).map(mapNotaFiscalRow);
    }
    const plain = await supabase
      .from('nota_fiscal')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (plain.error) throw new Error(plain.error.message);
    return ((plain.data as NotaFiscalListRow[] | null) ?? []).map((row) => ({
      ...row,
      cliente: null,
      emitente: null,
    }));
  }

  return (
    (withJoin.data as (NotaFiscalListRow & {
      clientes?: { nome_fantasia?: string; nome?: string } | null;
      nfse_emitente?: {
        id?: string;
        nome?: string;
        documento?: string;
        razao_social?: string;
      } | null;
    })[] | null) ?? []
  ).map(mapNotaFiscalRow);
}

export async function fetchUltimaNotaFiscalMensalidade(
  userId: string,
  mensalidadeId: string,
): Promise<NotaFiscalListRow | null> {
  const { data, error } = await supabase
    .from('nota_fiscal')
    .select('*, clientes(nome_fantasia, nome)')
    .eq('user_id', userId)
    .eq('mensalidade_id', mensalidadeId)
    .neq('status', 'cancelada')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapNotaFiscalRow(data as NotaFiscalListRow & { clientes?: { nome_fantasia?: string; nome?: string } | null });
}

export async function fetchNotaFiscalPorMensalidade(
  userId: string,
  mensalidadeId: string,
): Promise<NotaFiscalListRow | null> {
  const row = await fetchUltimaNotaFiscalMensalidade(userId, mensalidadeId);
  if (!row) return null;
  if (row.status === 'rejeitada') return null;
  return row;
}

export async function fetchNotaFiscalPorVenda(
  userId: string,
  vendaId: string,
): Promise<NotaFiscalListRow | null> {
  const row = await fetchUltimaNotaFiscalVenda(userId, vendaId);
  if (!row) return null;
  if (row.status === 'rejeitada') return null;
  return row;
}

export async function fetchUltimaNotaFiscalVenda(
  userId: string,
  vendaId: string,
): Promise<NotaFiscalListRow | null> {
  const { data, error } = await supabase
    .from('nota_fiscal')
    .select('*, clientes(nome_fantasia, nome)')
    .eq('user_id', userId)
    .eq('venda_id', vendaId)
    .neq('status', 'cancelada')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapNotaFiscalRow(data as NotaFiscalListRow & { clientes?: { nome_fantasia?: string; nome?: string } | null });
}

async function validarPreEmissaoNfse(
  userId: string,
  clienteId: string,
  emitenteId?: string | null,
): Promise<{ emitente: NfseEmitente }> {
  await ensureEmitentes(userId);

  let emitente: NfseEmitente | null = null;
  if (emitenteId) {
    emitente = await fetchEmitenteById(userId, emitenteId);
  }
  if (!emitente) {
    emitente = await fetchEmitentePadrao(userId);
  }

  const [perfil, clienteRes] = await Promise.all([
    fetchPerfilCobranca(userId),
    supabase.from('clientes').select(CLIENTE_EMBED_SELECT).eq('id', clienteId).single(),
  ]);

  if (clienteRes.error || !clienteRes.data) {
    throw new Error(clienteRes.error?.message ?? 'Cliente não encontrado.');
  }
  const clienteRow = mapClienteEnderecoFiscal(clienteRes.data as Parameters<typeof mapClienteEnderecoFiscal>[0]);
  const doc = onlyDigits(clienteRow.cnpj || clienteRow.documento);
  if (doc.length !== 11 && doc.length !== 14) {
    throw new Error(
      `Cliente "${clienteRow.nome_cliente}" sem CPF/CNPJ válido. Preencha o documento no cadastro antes de emitir NFS-e.`,
    );
  }

  if (emitente) {
    if (!emitente.razao_social?.trim() || onlyDigits(emitente.documento).length < 11) {
      throw new Error('Complete os dados do emitente (CNPJ) em Configurações › NFS-e.');
    }
    if (!emitente.codigo_ibge_emitente?.trim()) {
      throw new Error('Informe o código IBGE do município do emitente em Configurações › NFS-e.');
    }
    if (!emitente.codigo_tributacao_nacional?.trim()) {
      throw new Error('Informe o código de tributação nacional do serviço em Configurações › NFS-e.');
    }
    const cert = await fetchCertificadoAtivoEmitente(userId, emitente.id);
    if (!cert) {
      throw new Error('Cadastre o certificado A1 deste emitente em Configurações › NFS-e.');
    }
    return { emitente };
  }

  // Legado (migration 037 ainda não rodada)
  const config = await ensureNfeConfig(userId);
  if (!perfil?.razao_social?.trim() || !onlyDigits(perfil.documento).length) {
    throw new Error('Preencha os dados do beneficiário em Configurações antes de emitir NFS-e.');
  }
  if (!config.codigo_ibge_emitente?.trim()) {
    throw new Error('Informe o código IBGE do município do prestador em Configurações › NFS-e.');
  }
  if (!config.codigo_tributacao_nacional?.trim()) {
    throw new Error('Informe o código de tributação nacional do serviço em Configurações › NFS-e.');
  }

  return {
    emitente: {
      id: '',
      user_id: userId,
      nome: 'Emitente',
      documento: perfil.documento,
      razao_social: perfil.razao_social,
      logradouro: perfil.logradouro,
      numero: perfil.numero,
      complemento: perfil.complemento,
      bairro: perfil.bairro,
      cidade: perfil.cidade,
      uf: perfil.uf,
      cep: perfil.cep,
      serie: config.serie,
      proximo_numero: config.proximo_numero,
      ambiente: config.ambiente,
      inscricao_estadual: config.inscricao_estadual,
      regime_tributario: config.regime_tributario,
      codigo_ibge_emitente: config.codigo_ibge_emitente,
      inscricao_municipal: config.inscricao_municipal,
      ncm_servico: config.ncm_servico,
      cfop_padrao: config.cfop_padrao,
      cst_icms: config.cst_icms,
      csosn: config.csosn,
      descricao_servico_padrao: config.descricao_servico_padrao,
      natureza_operacao: config.natureza_operacao,
      codigo_tributacao_nacional: config.codigo_tributacao_nacional,
      codigo_tributacao_municipal: config.codigo_tributacao_municipal,
      codigo_nbs: config.codigo_nbs,
      op_simp_nac: config.op_simp_nac,
      reg_esp_trib: config.reg_esp_trib,
      trib_issqn: config.trib_issqn,
      tp_ret_issqn: config.tp_ret_issqn,
      padrao: true,
      created_at: '',
      updated_at: '',
    },
  };
}

async function inserirItensNotaFiscal(
  notaId: string,
  config: Pick<
    NfseEmitente,
    'codigo_tributacao_nacional' | 'codigo_nbs' | 'cst_icms' | 'csosn'
  >,
  descricao: string,
  valor: number,
): Promise<void> {
  const { error: itemErr } = await supabase.from('nota_fiscal_item').insert({
    nota_fiscal_id: notaId,
    numero_item: 1,
    descricao,
    ncm: config.codigo_tributacao_nacional,
    cfop: config.codigo_nbs,
    unidade: 'UN',
    quantidade: 1,
    valor_unitario: valor,
    valor_total: valor,
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
    valor,
  });
  if (pagErr) {
    await supabase.from('nota_fiscal').delete().eq('id', notaId);
    throw new Error(pagErr.message);
  }
}

async function bumpProximoNumero(userId: string, emitente: NfseEmitente, novoProximo: number) {
  if (emitente.id) {
    await supabase
      .from('nfse_emitente')
      .update({ proximo_numero: novoProximo })
      .eq('id', emitente.id)
      .eq('user_id', userId);
    if (emitente.padrao) {
      await supabase.from('nfe_config').update({ proximo_numero: novoProximo }).eq('user_id', userId);
    }
  } else {
    await supabase.from('nfe_config').update({ proximo_numero: novoProximo }).eq('user_id', userId);
  }
}

export async function criarNotaFiscalRascunhoMensalidade(
  userId: string,
  mensalidade: MensalidadeNfInput,
  opts?: EmitOpts,
): Promise<string> {
  const existente = await fetchUltimaNotaFiscalMensalidade(userId, mensalidade.id);
  if (existente) {
    if (existente.status === 'autorizada') {
      throw new Error('Já existe NFS-e autorizada para esta mensalidade.');
    }
    return existente.id;
  }

  const { emitente } = await validarPreEmissaoNfse(userId, mensalidade.cliente_id, opts?.emitenteId);

  const numero = emitente.proximo_numero;
  const descricao = descricaoItem(mensalidade.competencia, emitente.descricao_servico_padrao);

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    mensalidade_id: mensalidade.id,
    venda_id: null,
    cliente_id: mensalidade.cliente_id,
    serie: emitente.serie,
    numero,
    status: 'rascunho',
    valor_total: mensalidade.valor,
    natureza_operacao: emitente.natureza_operacao,
    ambiente: AMBIENTE_FISCAL_ATUAL,
    tipo_documento: 'nfse',
    competencia: mensalidade.competencia,
  };
  if (emitente.id) insertRow.emitente_id = emitente.id;

  const { data: nf, error: nfErr } = await supabase
    .from('nota_fiscal')
    .insert(insertRow)
    .select('id')
    .single();
  if (nfErr || !nf) throw wrapNotaFiscalInsertError(nfErr?.message);

  const notaId = nf.id as string;
  await inserirItensNotaFiscal(notaId, emitente, descricao, mensalidade.valor);
  await bumpProximoNumero(userId, emitente, numero + 1);

  return notaId;
}

export async function criarNotaFiscalRascunhoVenda(
  userId: string,
  venda: VendaNfInput,
  opts?: EmitOpts,
): Promise<string> {
  const existente = await fetchUltimaNotaFiscalVenda(userId, venda.id);
  if (existente) {
    if (existente.status === 'autorizada') {
      throw new Error('Já existe NFS-e autorizada para esta venda.');
    }
    return existente.id;
  }

  const { emitente } = await validarPreEmissaoNfse(userId, venda.cliente_id, opts?.emitenteId);

  const numero = emitente.proximo_numero;
  const descricao = venda.descricao.trim().slice(0, 2000) || emitente.descricao_servico_padrao;

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    mensalidade_id: null,
    venda_id: venda.id,
    cliente_id: venda.cliente_id,
    serie: emitente.serie,
    numero,
    status: 'rascunho',
    valor_total: venda.valor_total,
    natureza_operacao: emitente.natureza_operacao,
    ambiente: AMBIENTE_FISCAL_ATUAL,
    tipo_documento: 'nfse',
    competencia: null,
  };
  if (emitente.id) insertRow.emitente_id = emitente.id;

  const { data: nf, error: nfErr } = await supabase
    .from('nota_fiscal')
    .insert(insertRow)
    .select('id')
    .single();
  if (nfErr || !nf) throw wrapNotaFiscalInsertError(nfErr?.message);

  const notaId = nf.id as string;
  await inserirItensNotaFiscal(notaId, emitente, descricao, venda.valor_total);
  await bumpProximoNumero(userId, emitente, numero + 1);

  return notaId;
}

export async function gerarNotaFiscalParaVenda(
  userId: string,
  venda: VendaNfInput,
  opts?: EmitOpts,
): Promise<{ success: boolean; notaId?: string; message?: string }> {
  const existente = await fetchUltimaNotaFiscalVenda(userId, venda.id);
  if (existente?.status === 'autorizada') {
    return { success: true, notaId: existente.id, message: 'NFS-e já autorizada para esta venda.' };
  }

  const notaId = await criarNotaFiscalRascunhoVenda(userId, venda, opts);
  const res = await emitirNotaFiscalSefaz(notaId);
  if (res.success) {
    return { success: true, notaId };
  }
  return { success: false, notaId, message: res.message };
}

export async function gerarNotaFiscalParaMensalidade(
  userId: string,
  mensalidade: MensalidadeNfInput,
  opts?: EmitOpts,
): Promise<{ success: boolean; notaId?: string; message?: string; ignorada?: boolean }> {
  const existente = await fetchUltimaNotaFiscalMensalidade(userId, mensalidade.id);
  if (existente?.status === 'autorizada') {
    return {
      success: true,
      notaId: existente.id,
      message: 'NFS-e já autorizada para esta mensalidade.',
    };
  }

  const notaId = await criarNotaFiscalRascunhoMensalidade(userId, mensalidade, opts);
  const res = await emitirNotaFiscalSefaz(notaId);
  if (res.success) {
    return { success: true, notaId };
  }
  return { success: false, notaId, message: res.message };
}

type AvulsaNfInput = {
  cliente_id: string;
  valor: number;
  descricao: string;
  competencia?: string | null;
};

/** NFS-e avulsa (ex.: assinatura Azoup) sem vínculo com mensalidade/venda. */
export async function criarNotaFiscalRascunhoAvulsa(
  userId: string,
  input: AvulsaNfInput,
  opts?: EmitOpts,
): Promise<string> {
  const { emitente } = await validarPreEmissaoNfse(userId, input.cliente_id, opts?.emitenteId);

  const numero = emitente.proximo_numero;
  const descricao =
    input.descricao.trim().slice(0, 2000) ||
    descricaoItem(input.competencia ?? null, emitente.descricao_servico_padrao);

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    mensalidade_id: null,
    venda_id: null,
    cliente_id: input.cliente_id,
    serie: emitente.serie,
    numero,
    status: 'rascunho',
    valor_total: input.valor,
    natureza_operacao: emitente.natureza_operacao,
    ambiente: AMBIENTE_FISCAL_ATUAL,
    tipo_documento: 'nfse',
    competencia: input.competencia ?? null,
  };
  if (emitente.id) insertRow.emitente_id = emitente.id;

  const { data: nf, error: nfErr } = await supabase
    .from('nota_fiscal')
    .insert(insertRow)
    .select('id')
    .single();
  if (nfErr || !nf) throw wrapNotaFiscalInsertError(nfErr?.message);

  const notaId = nf.id as string;
  await inserirItensNotaFiscal(notaId, emitente, descricao, input.valor);
  await bumpProximoNumero(userId, emitente, numero + 1);

  return notaId;
}

export async function gerarNotaFiscalAvulsa(
  userId: string,
  input: AvulsaNfInput,
  opts?: EmitOpts,
): Promise<{ success: boolean; notaId?: string; message?: string }> {
  const notaId = await criarNotaFiscalRascunhoAvulsa(userId, input, opts);
  const res = await emitirNotaFiscalSefaz(notaId);
  if (res.success) {
    return { success: true, notaId };
  }
  return { success: false, notaId, message: res.message };
}

export async function reemitirNotaFiscalSefaz(notaFiscalId: string): Promise<EmitirNfeResult> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error('Sessão expirada. Faça login novamente.');

  const { data: nota, error } = await supabase
    .from('nota_fiscal')
    .select('id, status, user_id, numero, emitente_id')
    .eq('id', notaFiscalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!nota) throw new Error('Nota fiscal não encontrada.');
  if (nota.status === 'autorizada') {
    throw new Error('Esta NFS-e já está autorizada.');
  }
  if (nota.status === 'cancelada') {
    throw new Error('NFS-e cancelada não pode ser reemitida.');
  }

  let emitente = nota.emitente_id
    ? await fetchEmitenteById(userId, nota.emitente_id as string)
    : await fetchEmitentePadrao(userId);

  let novoNumero: number;
  if (emitente) {
    novoNumero = Number(emitente.proximo_numero) || Number(nota.numero) + 1;
  } else {
    const config = await ensureNfeConfig(userId);
    novoNumero = Number(config.proximo_numero) || Number(nota.numero) + 1;
    emitente = {
      id: '',
      user_id: userId,
      nome: '',
      documento: '',
      razao_social: '',
      logradouro: '',
      numero: '',
      complemento: '',
      bairro: '',
      cidade: '',
      uf: '',
      cep: '',
      serie: config.serie,
      proximo_numero: config.proximo_numero,
      ambiente: config.ambiente,
      inscricao_estadual: '',
      regime_tributario: 1,
      codigo_ibge_emitente: config.codigo_ibge_emitente,
      inscricao_municipal: '',
      ncm_servico: '',
      cfop_padrao: '',
      cst_icms: '',
      csosn: '',
      descricao_servico_padrao: '',
      natureza_operacao: '',
      codigo_tributacao_nacional: '',
      codigo_tributacao_municipal: '',
      codigo_nbs: '',
      op_simp_nac: 3,
      reg_esp_trib: 0,
      trib_issqn: 1,
      tp_ret_issqn: 1,
      padrao: true,
      created_at: '',
      updated_at: '',
    };
  }

  const { error: upErr } = await supabase
    .from('nota_fiscal')
    .update({
      numero: novoNumero,
      status: 'rascunho',
      motivo_rejeicao: null,
      chave_acesso: null,
      protocolo_autorizacao: null,
      codigo_verificacao: null,
      xml_autorizado: null,
    })
    .eq('id', notaFiscalId);
  if (upErr) throw new Error(upErr.message);

  await bumpProximoNumero(userId, emitente, novoNumero + 1);

  return emitirNotaFiscalSefaz(notaFiscalId);
}

export async function emitirNotaFiscalSefaz(notaFiscalId: string): Promise<EmitirNfeResult> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const base = nfeApiBaseUrl();
  if (!base) {
    throw new Error('URL da API NFS-e não configurada (EXPO_PUBLIC_NFE_API_URL ou origem web).');
  }

  await supabase.from('nota_fiscal').update({ status: 'processando', motivo_rejeicao: null }).eq('id', notaFiscalId);

  let res: Response;
  try {
    res = await fetch(`${base}/api/nfe/emitir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ notaFiscalId }),
    });
  } catch (e) {
    const msg = (e as Error).message || 'Falha de rede ao contactar a API de emissão.';
    await supabase
      .from('nota_fiscal')
      .update({ status: 'rejeitada', motivo_rejeicao: msg })
      .eq('id', notaFiscalId);
    return { success: false, message: msg };
  }

  const rawText = await res.text().catch(() => '');
  let body = {} as EmitirNfeResult & { error?: string; message?: string };
  if (rawText.trim()) {
    try {
      body = JSON.parse(rawText) as typeof body;
    } catch {
      body = {
        success: false,
        message: rawText.slice(0, 500) || `Emissão falhou (${res.status}).`,
      };
    }
  } else if (!res.ok) {
    body = {
      success: false,
      message:
        res.status === 500
          ? 'Erro interno na API de emissão. Verifique na Vercel: SUPABASE_SERVICE_ROLE_KEY, CERT_ENCRYPTION_KEY (mesma chave do app) e redeploy.'
          : `Emissão falhou (${res.status}).`,
    };
  }

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
    .select('mensalidade_id, venda_id')
    .eq('id', notaFiscalId)
    .maybeSingle();
  if (notaRow?.mensalidade_id) {
    await vincularNotaFiscalAoBoletoMensalidade(notaRow.mensalidade_id, notaFiscalId).catch(() => undefined);
  }
  if (notaRow?.venda_id) {
    await vincularNotaFiscalAoBoletoVenda(notaRow.venda_id, notaFiscalId).catch(() => undefined);
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
  opts?: EmitOpts,
): Promise<{ emitidas: number; rejeitadas: number; ignoradas: number; erros: string[] }> {
  const padrao = await fetchEmitentePadrao(userId);
  const emitenteId = opts?.emitenteId || padrao?.id;
  if (emitenteId) {
    const cert = await fetchCertificadoAtivoEmitente(userId, emitenteId);
    if (!cert) {
      throw new Error('Cadastre o certificado A1 do emitente em Configurações › NFS-e antes de gerar notas.');
    }
  } else {
    const cert = await fetchCertificadoAtivo(userId);
    if (!cert) {
      throw new Error('Cadastre o certificado A1 em Configurações › NFS-e antes de gerar notas fiscais.');
    }
  }

  const clienteIds = [...new Set(mensalidades.map((m) => m.cliente_id))];
  const { data: clientesRows, error: cliErr } = await supabase
    .from('clientes')
    .select('id, emite_nf, nome_fantasia, nome')
    .in('id', clienteIds);
  if (cliErr) throw new Error(cliErr.message);

  const emitePorCliente = new Map(
    (clientesRows ?? []).map((c) => [
      c.id as string,
      Boolean(c.emite_nf),
    ]),
  );

  let emitidas = 0;
  let rejeitadas = 0;
  let ignoradas = 0;
  const erros: string[] = [];

  for (const m of mensalidades) {
    if (!emitePorCliente.get(m.cliente_id)) {
      ignoradas += 1;
      continue;
    }

    try {
      const result = await gerarNotaFiscalParaMensalidade(userId, m, { emitenteId });
      if (result.ignorada) {
        ignoradas += 1;
        continue;
      }
      if (result.success) {
        emitidas += 1;
      } else {
        rejeitadas += 1;
        if (result.message) erros.push(result.message);
      }
    } catch (e) {
      rejeitadas += 1;
      erros.push((e as Error).message);
    }
  }

  return { emitidas, rejeitadas, ignoradas, erros };
}

/** Mapa mensalidade_id → nota fiscal (qualquer status exceto cancelada). */
export async function fetchNotasFiscaisPorMensalidadeIds(
  userId: string,
  mensalidadeIds: string[],
): Promise<Map<string, NotaFiscalListRow>> {
  const map = new Map<string, NotaFiscalListRow>();
  if (!mensalidadeIds.length) return map;

  const { data, error } = await supabase
    .from('nota_fiscal')
    .select('*, clientes(nome_fantasia, nome)')
    .eq('user_id', userId)
    .in('mensalidade_id', mensalidadeIds)
    .neq('status', 'cancelada')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as (NotaFiscalListRow & { clientes?: { nome_fantasia?: string; nome?: string } | null })[]) {
    const mid = row.mensalidade_id;
    if (mid && !map.has(mid)) {
      map.set(mid, mapNotaFiscalRow(row));
    }
  }
  return map;
}

/** Mapa venda_id → nota fiscal (qualquer status exceto cancelada). */
export async function fetchNotasFiscaisPorVendaIds(
  userId: string,
  vendaIds: string[],
): Promise<Map<string, NotaFiscalListRow>> {
  const map = new Map<string, NotaFiscalListRow>();
  if (!vendaIds.length) return map;

  const { data, error } = await supabase
    .from('nota_fiscal')
    .select('*, clientes(nome_fantasia, nome)')
    .eq('user_id', userId)
    .in('venda_id', vendaIds)
    .neq('status', 'cancelada')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as (NotaFiscalListRow & { clientes?: { nome_fantasia?: string; nome?: string } | null })[]) {
    const vid = row.venda_id;
    if (vid && !map.has(vid)) {
      map.set(vid, mapNotaFiscalRow(row));
    }
  }
  return map;
}
