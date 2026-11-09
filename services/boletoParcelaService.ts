import { supabase } from '@/lib/supabase';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import { fetchNotasFiscaisPorMensalidadeIds, fetchNotasFiscaisPorVendaIds } from '@/services/notaFiscalService';
import { emitirBoletosC6Lote } from '@/services/c6BoletoService';
import { emitirBoletosSicoobLote } from '@/services/sicoobBoletoService';
import { ensureEmitentes } from '@/services/nfseEmitenteService';
import { pickEmitenteC6 } from '@/services/c6ConfigService';
import type { BoletoParcelaVendaRow, ContaReceberListRow, PerfilCobranca } from '@/types/contasReceber';
import type { NfseEmitente } from '@/types/notaFiscal';
import { situacaoCobrancaDeStatus } from '@/utils/contaReceberCobranca';
import { CLIENTE_EMBED_SELECT, mapClienteEnderecoFiscal, type ClienteDbRow } from '@/utils/clientesDbMapping';
import { clienteDocFiscal } from '@/utils/cnpj';
import { toISODate } from '@/utils/date';
import { getSegmentoNomePorCodigo } from '@/services/segmentoClienteService';

const SQL_MIGRATION_BOLETOS_HINT =
  'Execute no Supabase (SQL Editor) o arquivo supabase/migrations/034_contas_receber_boletos_setup.sql';

function wrapBoletoDbError(error: { message?: string; code?: string } | null): Error {
  const msg = error?.message ?? 'Erro ao gravar carnê em contas a receber.';
  if (
    error?.code === '42P01' ||
    /does not exist|boletos_parcela_venda/i.test(msg)
  ) {
    return new Error(`${SQL_MIGRATION_BOLETOS_HINT}\n\n${msg}`);
  }
  if (/mensalidade_id|origem|chk_boletos_parc_origem/i.test(msg)) {
    return new Error(`${SQL_MIGRATION_BOLETOS_HINT}\n\n${msg}`);
  }
  if (/j[aá] tem boleto neste dia|j[aá] existe boleto deste cliente/i.test(msg)) {
    return new Error('Este cliente já tem boleto neste dia. Não gere nem emita outro.');
  }
  if (/invalid input syntax for type uuid/i.test(msg)) {
    return new Error(
      'O carnê não foi gravado: a trava de um boleto por dia rejeitou o código do cliente. Rode no SQL Editor o arquivo supabase/migrations/053_boleto_cliente_dia_sem_uuid.sql e depois toque em “Gerar boletos que faltaram”. Não gere a mensalidade de novo.',
    );
  }
  return new Error(msg);
}

function diaIsoBoleto(valor: string): string {
  return String(valor ?? '').slice(0, 10);
}

export function textoDiaBoleto(valor: string): string {
  const dia = diaIsoBoleto(valor);
  const [ano, mes, diaNum] = dia.split('-');
  if (!ano || !mes || !diaNum) return dia;
  return `${diaNum}/${mes}/${ano}`;
}

function chaveClienteDia(clienteId: string, data: string): string {
  return `${String(clienteId)}|${diaIsoBoleto(data)}`;
}

/** Clientes que já têm carnê não baixado naquele vencimento. */
export async function chavesBoletoClienteDia(
  userId: string,
  clienteIds: string[],
  datas: string[],
  opts?: { excluirVendaId?: string },
): Promise<Set<string>> {
  const chaves = new Set<string>();
  const ids = [...new Set(clienteIds.filter(Boolean))];
  const dias = [...new Set(datas.map(diaIsoBoleto).filter(Boolean))];
  if (!ids.length || !dias.length) return chaves;

  for (let i = 0; i < ids.length; i += 80) {
    const fatia = ids.slice(i, i + 80);
    const { data: mens, error: eM } = await supabase
      .from('mensalidades')
      .select('id, cliente_id, data_vencimento')
      .eq('user_id', userId)
      .in('cliente_id', fatia)
      .in('data_vencimento', dias)
      .neq('status', 'cancelado');
    if (eM) throw new Error(eM.message);
    const mensRows = (mens ?? []) as { id: string; cliente_id: string; data_vencimento: string }[];
    const clientePorMens = new Map(mensRows.map((m) => [m.id, m.cliente_id]));
    for (let j = 0; j < mensRows.length; j += 80) {
      const mensIds = mensRows.slice(j, j + 80).map((m) => m.id);
      const { data: bols, error: eB } = await supabase
        .from('boletos_parcela_venda')
        .select('mensalidade_id, data_vencimento')
        .eq('user_id', userId)
        .in('mensalidade_id', mensIds)
        .neq('status_registro', 'baixado');
      if (eB) throw new Error(eB.message);
      for (const b of bols ?? []) {
        const cid = clientePorMens.get(b.mensalidade_id as string);
        if (cid) chaves.add(chaveClienteDia(cid, b.data_vencimento as string));
      }
    }

    const { data: vendas, error: eV } = await supabase
      .from('vendas')
      .select('id, cliente_id')
      .eq('user_id', userId)
      .in('cliente_id', fatia);
    if (eV) throw new Error(eV.message);
    const vendaRows = (vendas ?? []) as { id: string; cliente_id: string }[];
    const clientePorVenda = new Map(vendaRows.map((v) => [v.id, v.cliente_id]));
    for (let j = 0; j < vendaRows.length; j += 80) {
      const vendaIds = vendaRows.slice(j, j + 80).map((v) => v.id);
      const { data: bols, error: eB } = await supabase
        .from('boletos_parcela_venda')
        .select('venda_id, data_vencimento')
        .eq('user_id', userId)
        .in('venda_id', vendaIds)
        .in('data_vencimento', dias)
        .neq('status_registro', 'baixado');
      if (eB) throw new Error(eB.message);
      for (const b of bols ?? []) {
        if (opts?.excluirVendaId && b.venda_id === opts.excluirVendaId) continue;
        const cid = clientePorVenda.get(b.venda_id as string);
        if (cid) chaves.add(chaveClienteDia(cid, b.data_vencimento as string));
      }
    }
  }
  return chaves;
}

/** Mensalidade em aberto ou carnê já gerado naquele dia. */
export async function chavesCobrancaClienteDia(
  userId: string,
  clienteIds: string[],
  datas: string[],
): Promise<Set<string>> {
  const chaves = await chavesBoletoClienteDia(userId, clienteIds, datas);
  const ids = [...new Set(clienteIds.filter(Boolean))];
  const dias = [...new Set(datas.map(diaIsoBoleto).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 80) {
    const fatia = ids.slice(i, i + 80);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('mensalidades')
        .select('cliente_id, data_vencimento')
        .eq('user_id', userId)
        .in('cliente_id', fatia)
        .in('data_vencimento', dias)
        .neq('status', 'cancelado')
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        chaves.add(chaveClienteDia(r.cliente_id as string, r.data_vencimento as string));
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return chaves;
}

const PLACEHOLDER_BENEF = '— Preencha em Configurações › Dados do beneficiário —';

type ClienteAddr = ReturnType<typeof mapClienteEnderecoFiscal>;

type SnapshotBenefPag = {
  beneficiario_razao_social: string;
  beneficiario_documento: string;
  beneficiario_endereco: string;
  beneficiario_bairro: string;
  beneficiario_cidade_uf_cep: string;
  pagador_nome: string;
  pagador_documento: string;
  pagador_endereco: string;
  pagador_cidade_uf_cep: string;
  mensagem_pagador: string | null;
  local_pagamento: string;
  cooperativa_rodape: string | null;
  data_documento: string;
};

function trimJoin(parts: (string | null | undefined)[], sep: string): string {
  return parts
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .join(sep);
}

function linhaEnderecoCliente(c: ClienteAddr): string {
  return trimJoin([c.logradouro, c.numero, c.complemento], ', ');
}

function cidadeUfCepCliente(c: ClienteAddr): string {
  const cidadeUf = trimJoin([c.cidade, c.uf], ' / ');
  const cep = (c.cep ?? '').trim();
  return trimJoin([cidadeUf, cep], ' · ');
}

function camposPagadorDoCliente(cli: ClienteAddr): {
  pagador_nome: string;
  pagador_documento: string;
  pagador_endereco: string;
  pagador_cidade_uf_cep: string;
} {
  const pagNome = (cli.nome_empresa || cli.nome_cliente || '').trim();
  return {
    pagador_nome: pagNome || '—',
    pagador_documento: clienteDocFiscal(cli) || '—',
    pagador_endereco: linhaEnderecoCliente(cli) || '—',
    pagador_cidade_uf_cep: cidadeUfCepCliente(cli) || '—',
  };
}

/** Atualiza endereço/cidade do pagador nos boletos em aberto desse cliente. */
export async function sincronizarEnderecoPagadorBoletos(clienteId: string): Promise<void> {
  const id = String(clienteId ?? '').trim();
  if (!id) return;

  const { data: cliente, error } = await supabase
    .from('clientes')
    .select(CLIENTE_EMBED_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cliente) return;

  const campos = camposPagadorDoCliente(mapClienteEnderecoFiscal(cliente as ClienteDbRow));

  const [{ data: mens }, { data: vendas }] = await Promise.all([
    supabase.from('mensalidades').select('id').eq('cliente_id', id),
    supabase.from('vendas').select('id').eq('cliente_id', id),
  ]);
  const mensIds = (mens ?? []).map((r) => String((r as { id: string }).id));
  const vendaIds = (vendas ?? []).map((r) => String((r as { id: string }).id));
  if (!mensIds.length && !vendaIds.length) return;

  const abertos = ['informativo', 'pendente', 'registrado', 'erro'];
  if (mensIds.length) {
    const { error: e1 } = await supabase
      .from('boletos_parcela_venda')
      .update(campos)
      .in('mensalidade_id', mensIds)
      .in('status_registro', abertos);
    if (e1) throw new Error(e1.message);
  }
  if (vendaIds.length) {
    const { error: e2 } = await supabase
      .from('boletos_parcela_venda')
      .update(campos)
      .in('venda_id', vendaIds)
      .in('status_registro', abertos);
    if (e2) throw new Error(e2.message);
  }
}

/** Lê o endereço atual do cliente para o carnê HTML, sem depender do snapshot antigo. */
export async function enderecoPagadorAtualDoBoleto(
  boleto: Pick<BoletoParcelaVendaRow, 'mensalidade_id' | 'venda_id' | 'pagador_nome' | 'pagador_documento' | 'pagador_endereco' | 'pagador_cidade_uf_cep'>,
): Promise<{
  pagador_nome: string;
  pagador_documento: string;
  pagador_endereco: string;
  pagador_cidade_uf_cep: string;
} | null> {
  let clienteId: string | null = null;
  if (boleto.mensalidade_id) {
    const { data } = await supabase
      .from('mensalidades')
      .select('cliente_id')
      .eq('id', boleto.mensalidade_id)
      .maybeSingle();
    clienteId = (data as { cliente_id?: string } | null)?.cliente_id ?? null;
  } else if (boleto.venda_id) {
    const { data } = await supabase
      .from('vendas')
      .select('cliente_id')
      .eq('id', boleto.venda_id)
      .maybeSingle();
    clienteId = (data as { cliente_id?: string } | null)?.cliente_id ?? null;
  }
  if (!clienteId) return null;
  const { data: cliente, error } = await supabase
    .from('clientes')
    .select(CLIENTE_EMBED_SELECT)
    .eq('id', clienteId)
    .maybeSingle();
  if (error || !cliente) return null;
  return camposPagadorDoCliente(mapClienteEnderecoFiscal(cliente as ClienteDbRow));
}

function linhaEnderecoBenef(perfil: {
  logradouro: string;
  numero: string;
  complemento: string;
}): string {
  return trimJoin([perfil.logradouro, perfil.numero, perfil.complemento], ', ');
}

function cidadeUfCepBenef(perfil: {
  cidade: string;
  uf: string;
  cep: string;
  bairro: string;
}): string {
  const linha = trimJoin([perfil.cidade, perfil.uf?.toUpperCase().slice(0, 2)], ' / ');
  const cep = (perfil.cep ?? '').trim();
  const b = (perfil.bairro ?? '').trim();
  return trimJoin([b, linha, cep], ' · ');
}

function nossoNumeroDeId(id: string): string {
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}

function numeroDocumentoVenda(vendaId: string, n: number, total: number): string {
  const short = vendaId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `VD-${short}-${String(n).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
}

function numeroDocumentoMensalidade(mensalidadeId: string, competencia: string | null): string {
  const short = mensalidadeId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const comp = (competencia ?? '').trim().replace(/\s+/g, '-') || 'SEM-COMP';
  return `MEN-${short}-${comp}`;
}

function montarInstrucoesVenda(
  perfil: PerfilCobranca | null,
  descricao: string,
  n: number,
  total: number,
): string {
  const base = (perfil?.instrucoes_cobranca ?? '').trim();
  const tel = (perfil?.telefone_suporte ?? '').trim();
  const ref = `Referência: venda — parcela ${n} de ${total}.`;
  const bloco = [ref, descricao.trim(), base, tel ? `Dúvidas: ${tel}` : '']
    .filter(Boolean)
    .join('\n');
  return bloco || ref;
}

function montarInstrucoesMensalidade(
  perfil: PerfilCobranca | null,
  competencia: string | null,
): string {
  const base = (perfil?.instrucoes_cobranca ?? '').trim();
  const tel = (perfil?.telefone_suporte ?? '').trim();
  const comp = (competencia ?? '').trim();
  const ref = comp
    ? `Referência: mensalidade recorrente — competência ${comp}.`
    : 'Referência: mensalidade recorrente.';
  const bloco = [ref, base, tel ? `Dúvidas: ${tel}` : '']
    .filter(Boolean)
    .join('\n');
  return bloco || ref;
}

async function fetchClienteAddr(userId: string, clienteId: string): Promise<ClienteAddr> {
  const { data: cliente, error } = await supabase
    .from('clientes')
    .select(CLIENTE_EMBED_SELECT)
    .eq('id', clienteId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!cliente) throw new Error('Cliente não encontrado para gerar boleto.');
  return mapClienteEnderecoFiscal(cliente as ClienteDbRow);
}

async function buildSnapshotBenefPag(
  userId: string,
  clienteId: string,
  emitente?: Pick<
    NfseEmitente,
    'razao_social' | 'documento' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep'
  > | null,
): Promise<SnapshotBenefPag> {
  const cli = await fetchClienteAddr(userId, clienteId);
  const perfil = await fetchPerfilCobranca(userId).catch(() => null);
  const hoje = toISODate(new Date());

  const benefRazao =
    (emitente?.razao_social ?? '').trim() ||
    (perfil?.razao_social ?? '').trim() ||
    PLACEHOLDER_BENEF;
  const benefDoc =
    (emitente?.documento ?? '').trim() || (perfil?.documento ?? '').trim() || '—';
  const benefEnd =
    emitente && (emitente.logradouro.trim() || emitente.numero.trim())
      ? linhaEnderecoBenef(emitente)
      : perfil && (perfil.logradouro.trim() || perfil.numero.trim())
      ? linhaEnderecoBenef(perfil)
      : '—';
  const benefBairro = (emitente?.bairro ?? perfil?.bairro ?? '').trim() || '—';
  const benefCidade =
    emitente && (emitente.cidade.trim() || emitente.uf.trim())
      ? cidadeUfCepBenef({
          cidade: emitente.cidade,
          uf: emitente.uf,
          cep: emitente.cep,
          bairro: emitente.bairro,
        })
      : perfil && (perfil.cidade.trim() || perfil.uf.trim())
      ? cidadeUfCepBenef({
          cidade: perfil.cidade,
          uf: perfil.uf,
          cep: perfil.cep,
          bairro: perfil.bairro,
        })
      : '—';

  const pagador = camposPagadorDoCliente(cli);

  return {
    beneficiario_razao_social: benefRazao,
    beneficiario_documento: benefDoc,
    beneficiario_endereco: benefEnd,
    beneficiario_bairro: benefBairro,
    beneficiario_cidade_uf_cep: benefCidade,
    ...pagador,
    mensagem_pagador: (perfil?.mensagem_padrao_pagador ?? '').trim() || null,
    local_pagamento:
      (perfil?.local_pagamento ?? '').trim() || 'PAGÁVEL PREFERENCIALMENTE NOS CANAIS DO SEU BANCO',
    cooperativa_rodape: (perfil?.cooperativa_nome ?? '').trim() || null,
    data_documento: hoje,
  };
}

async function resolveEmitenteCobranca(
  userId: string,
  emitenteId?: string | null,
  banco?: 'sicoob' | 'c6' | null,
): Promise<NfseEmitente | null> {
  try {
    const list = await ensureEmitentes(userId);
    if (!list.length) return null;
    if (emitenteId) {
      const found = list.find((e) => e.id === emitenteId);
      if (found) return found;
    }
    if (banco === 'c6') {
      return pickEmitenteC6(list) ?? list.find((e) => e.banco_cobranca === 'c6') ?? list[0] ?? null;
    }
    if (banco === 'sicoob') {
      return (
        list.find((e) => e.banco_cobranca === 'sicoob' && e.padrao) ??
        list.find((e) => e.banco_cobranca === 'sicoob') ??
        list.find((e) => e.banco_cobranca !== 'c6') ??
        list.find((e) => e.padrao) ??
        list[0] ??
        null
      );
    }
    return list.find((e) => e.padrao) ?? list[0] ?? null;
  } catch {
    return null;
  }
}

function bancoDoEmitente(emitente: NfseEmitente | null, bancoOverride?: 'sicoob' | 'c6' | null): 'sicoob' | 'c6' {
  if (bancoOverride === 'c6' || bancoOverride === 'sicoob') return bancoOverride;
  return emitente?.banco_cobranca === 'c6' ? 'c6' : 'sicoob';
}

/** Chamado logo após inserir parcelas da venda. */
export async function gerarBoletosParaVendaCriada(
  userId: string,
  vendaId: string,
  opts: { descricao: string; banco?: 'sicoob' | 'c6' | null },
): Promise<{ avisoEmail?: string; avisoBoleto?: string }> {
  const { data: venda, error: e0 } = await supabase
    .from('vendas')
    .select('cliente_id')
    .eq('id', vendaId)
    .eq('user_id', userId)
    .maybeSingle();

  if (e0) throw new Error(e0.message);
  if (!venda) throw new Error('Venda não encontrada para gerar boletos.');

  const clienteId = String((venda as { cliente_id: string | number | null }).cliente_id ?? '').trim();
  if (!clienteId || clienteId === 'null' || clienteId === 'undefined') {
    throw new Error('Esta venda está sem cliente. Não dá para gerar boleto em A receber.');
  }
  const { data: cliRow } = await supabase
    .from('clientes')
    .select('emitente_nf_id')
    .eq('id', clienteId)
    .maybeSingle();
  const emitenteNfId = (cliRow as { emitente_nf_id?: string | null } | null)?.emitente_nf_id ?? null;
  const emitente = await resolveEmitenteCobranca(
    userId,
    emitenteNfId,
    opts.banco === 'c6' || opts.banco === 'sicoob' ? opts.banco : null,
  );
  const banco = bancoDoEmitente(emitente, opts.banco ?? null);
  const snap = await buildSnapshotBenefPag(userId, clienteId, emitente);
  const perfil = await fetchPerfilCobranca(userId).catch(() => null);

  const { data: parcelas, error: e2 } = await supabase
    .from('parcelas_venda')
    .select('id, numero_parcela, valor, data_vencimento')
    .eq('venda_id', vendaId)
    .order('numero_parcela', { ascending: true });

  if (e2) throw new Error(e2.message);
  const plist = (parcelas ?? []) as {
    id: string;
    numero_parcela: number;
    valor: number;
    data_vencimento: string;
  }[];
  if (!plist.length) throw new Error('Nenhuma parcela para gerar boletos.');

  const { data: jaTem, error: eJa } = await supabase
    .from('boletos_parcela_venda')
    .select('parcela_id')
    .eq('venda_id', vendaId)
    .not('parcela_id', 'is', null);
  if (eJa) throw wrapBoletoDbError(eJa);
  const comBoleto = new Set(
    ((jaTem ?? []) as { parcela_id: string | null }[])
      .map((b) => b.parcela_id)
      .filter((id): id is string => Boolean(id)),
  );
  const faltantes = plist.filter((p) => !comBoleto.has(p.id));
  if (!faltantes.length) return {};

  const ocupados = await chavesBoletoClienteDia(
    userId,
    [clienteId],
    faltantes.map((p) => p.data_vencimento),
    { excluirVendaId: vendaId },
  );
  const bloqueadas: string[] = [];
  const livres = faltantes.filter((p) => {
    const chave = chaveClienteDia(clienteId, p.data_vencimento);
    if (ocupados.has(chave)) {
      bloqueadas.push(`parcela ${p.numero_parcela} (${textoDiaBoleto(p.data_vencimento)})`);
      return false;
    }
    return true;
  });
  if (!livres.length) {
    throw new Error(
      `Este cliente já tem boleto neste dia (${bloqueadas.join(', ')}). Não gerei outro nesses vencimentos.`,
    );
  }

  const total = plist.length;
  const insertedIds: string[] = [];
  const falhasInsert: string[] = [];
  for (const p of livres) {
    const descResumo = `${opts.descricao.trim()}\nParcela ${p.numero_parcela} de ${total}.`;
    const row = {
      user_id: userId,
      origem: 'venda' as const,
      venda_id: vendaId,
      parcela_id: p.id,
      mensalidade_id: null,
      numero_parcela: p.numero_parcela,
      total_parcelas_venda: total,
      ...snap,
      venda_descricao_resumo: descResumo.slice(0, 4000),
      valor_documento: p.valor,
      data_vencimento: p.data_vencimento,
      nosso_numero: nossoNumeroDeId(p.id),
      numero_documento: numeroDocumentoVenda(vendaId, p.numero_parcela, total),
      instrucoes: montarInstrucoesVenda(perfil, opts.descricao, p.numero_parcela, total).slice(0, 4000),
      emitente_id: emitente?.id ?? null,
      tipo_emissao: banco,
      status_registro: 'pendente' as const,
    };
    const { data: inserted, error: e3 } = await supabase
      .from('boletos_parcela_venda')
      .insert(row)
      .select('id')
      .maybeSingle();
    if (e3) {
      falhasInsert.push(`parcela ${p.numero_parcela}: ${wrapBoletoDbError(e3).message}`);
      continue;
    }
    if (inserted?.id) insertedIds.push(inserted.id as string);
  }

  const boletoIds = insertedIds;
  let avisoEmail: string | undefined;
  if (boletoIds.length) {
    const { resumoEmailBoletosLote } = await import('@/utils/resumoEmailBoleto');
    try {
      if (banco === 'c6' && emitente?.id) {
        const lote = await emitirBoletosC6Lote(userId, emitente.id, boletoIds, { modoRapido: true });
        avisoEmail = resumoEmailBoletosLote(lote) ?? undefined;
      } else {
        const lote = await emitirBoletosSicoobLote(userId, boletoIds);
        avisoEmail = resumoEmailBoletosLote(lote) ?? undefined;
      }
    } catch {
      // Carnê informativo permanece em A receber; banco pode ser reemitido depois.
    }
  }
  if (!boletoIds.length && (bloqueadas.length || falhasInsert.length)) {
    throw new Error(
      [...bloqueadas.map((d) => `Já existe boleto neste dia (${d}).`), ...falhasInsert].join(' '),
    );
  }
  if (bloqueadas.length || falhasInsert.length) {
    return {
      avisoEmail,
      avisoBoleto: [
        boletoIds.length ? `Gerei ${boletoIds.length} carnê(s) em A receber.` : null,
        bloqueadas.length
          ? `Não gerei outro nestes vencimentos: ${bloqueadas.join(', ')}.`
          : null,
        ...falhasInsert,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }
  return { avisoEmail };
}

export type MensalidadeParaBoleto = {
  id: string;
  cliente_id: string;
  valor: number;
  data_vencimento: string;
  competencia: string | null;
};

/** Um carnê em contas a receber por mensalidade gerada.
 * Padrão: CNPJ da empresa no cadastro do cliente (`emitente_nf_id`).
 * Se `usarEmitenteDoCliente === false` e houver `emitenteId`, força esse CNPJ/banco para todos.
 */
export async function gerarBoletosParaMensalidades(
  userId: string,
  mensalidades: MensalidadeParaBoleto[],
  opts?: {
    emitenteId?: string | null;
    banco?: 'sicoob' | 'c6' | null;
    usarEmitenteDoCliente?: boolean;
    /** false = só o carnê em A receber, sem chamar Sicoob/C6. */
    registrarNoBanco?: boolean;
  },
): Promise<{ avisoSicoob?: string; avisoBoleto?: string; avisoEmail?: string; falhasBoleto?: { mensalidadeId: string | null; erro: string }[] }> {
  if (!mensalidades.length) return {};

  const usarDoCliente = opts?.usarEmitenteDoCliente !== false;
  const forcarEmitente = !usarDoCliente && Boolean(opts?.emitenteId);
  const registrarNoBanco = opts?.registrarNoBanco !== false;

  // Uma mensalidade = no máximo um carnê (índice único no banco; evita reprocessar).
  const vistos = new Set<string>();
  const unicos = mensalidades.filter((m) => {
    if (vistos.has(m.id)) return false;
    vistos.add(m.id);
    return true;
  });
  const idsMen = unicos.map((m) => m.id);
  const { data: jaTemBoleto, error: eJa } = await supabase
    .from('boletos_parcela_venda')
    .select('mensalidade_id')
    .in('mensalidade_id', idsMen);
  if (eJa) throw wrapBoletoDbError(eJa);
  const comBoleto = new Set(
    ((jaTemBoleto ?? []) as { mensalidade_id: string | null }[])
      .map((b) => b.mensalidade_id)
      .filter(Boolean) as string[],
  );
  const mensalidadesNovas = unicos.filter((m) => !comBoleto.has(m.id));
  if (!mensalidadesNovas.length) return {};

  const ocupados = await chavesBoletoClienteDia(
    userId,
    mensalidadesNovas.map((m) => m.cliente_id),
    mensalidadesNovas.map((m) => m.data_vencimento),
  );
  const falhasDia: { mensalidadeId: string | null; erro: string }[] = [];
  const mensalidadesLivres = mensalidadesNovas.filter((m) => {
    const chave = `${m.cliente_id}|${String(m.data_vencimento).slice(0, 10)}`;
    if (ocupados.has(chave)) {
      falhasDia.push({
        mensalidadeId: m.id,
        erro: `Este cliente já tem boleto neste dia (${textoDiaBoleto(m.data_vencimento)}). Não gere nem emita outro.`,
      });
      return false;
    }
    ocupados.add(chave);
    return true;
  });
  if (!mensalidadesLivres.length) {
    return { falhasBoleto: falhasDia };
  }

  const emitentesList = await ensureEmitentes(userId).catch(() => [] as NfseEmitente[]);
  const emitenteById = new Map(emitentesList.map((e) => [e.id, e]));

  const clienteIds = [...new Set(mensalidadesLivres.map((m) => m.cliente_id))];
  const { data: clientesRows, error: eCli } = await supabase
    .from('clientes')
    .select('id, emitente_nf_id')
    .in('id', clienteIds);
  if (eCli) throw new Error(eCli.message);
  const emitenteNfPorCliente = new Map(
    ((clientesRows ?? []) as { id: string; emitente_nf_id: string | null }[]).map((c) => [
      c.id,
      c.emitente_nf_id,
    ]),
  );

  const perfil = await fetchPerfilCobranca(userId).catch(() => null);
  const snapCache = new Map<string, SnapshotBenefPag>();
  const rows: Record<string, unknown>[] = [];
  const meta: { banco: 'sicoob' | 'c6'; emitenteId: string | null }[] = [];

  for (const m of mensalidadesLivres) {
    const emitenteClienteId = emitenteNfPorCliente.get(m.cliente_id) ?? null;
    let emitente: NfseEmitente | null = null;
    let banco: 'sicoob' | 'c6';

    if (forcarEmitente) {
      emitente = await resolveEmitenteCobranca(userId, opts?.emitenteId, opts?.banco);
      banco = bancoDoEmitente(emitente, opts?.banco);
    } else {
      emitente =
        (emitenteClienteId ? emitenteById.get(emitenteClienteId) : undefined) ??
        (await resolveEmitenteCobranca(
          userId,
          emitenteClienteId || opts?.emitenteId,
          emitenteClienteId ? null : opts?.banco,
        ));
      banco = bancoDoEmitente(emitente, emitenteClienteId ? null : opts?.banco);
    }

    let snap = snapCache.get(`${m.cliente_id}:${emitente?.id ?? ''}`);
    if (!snap) {
      snap = await buildSnapshotBenefPag(userId, m.cliente_id, emitente);
      snapCache.set(`${m.cliente_id}:${emitente?.id ?? ''}`, snap);
    }
    const comp = m.competencia?.trim() || null;
    const descResumo = comp
      ? `Mensalidade recorrente\nCompetência: ${comp}`
      : 'Mensalidade recorrente';

    rows.push({
      user_id: userId,
      origem: 'mensalidade',
      venda_id: null,
      parcela_id: null,
      mensalidade_id: m.id,
      numero_parcela: 1,
      total_parcelas_venda: 1,
      ...snap,
      venda_descricao_resumo: descResumo.slice(0, 4000),
      valor_documento: m.valor,
      data_vencimento: m.data_vencimento,
      nosso_numero: nossoNumeroDeId(m.id),
      numero_documento: numeroDocumentoMensalidade(m.id, comp),
      instrucoes: montarInstrucoesMensalidade(perfil, comp).slice(0, 4000),
      emitente_id: emitente?.id ?? null,
      tipo_emissao: registrarNoBanco ? banco : 'informativo',
      status_registro: registrarNoBanco ? 'pendente' : 'informativo',
    });
    meta.push({ banco, emitenteId: emitente?.id ?? null });
  }

  const { data: inserted, error } = await supabase
    .from('boletos_parcela_venda')
    .insert(rows)
    .select('id, mensalidade_id');
  if (error) {
    if (/emitente_id|c6_|column|schema cache/i.test(error.message)) {
      throw new Error(
        'Rode a migration 045_c6_boleto.sql no SQL Editor do Supabase.\n\n' + error.message,
      );
    }
    throw wrapBoletoDbError(error);
  }

  const insertedRows = (inserted ?? []) as { id: string; mensalidade_id: string | null }[];
  if (!insertedRows.length || !registrarNoBanco) return { falhasBoleto: falhasDia };

  const metaPorMensalidade = new Map<string, { banco: 'sicoob' | 'c6'; emitenteId: string | null }>();
  mensalidadesLivres.forEach((m, i) => {
    metaPorMensalidade.set(m.id, meta[i]!);
  });

  const grupos = new Map<string, { banco: 'sicoob' | 'c6'; emitenteId: string | null; ids: string[] }>();
  for (const bol of insertedRows) {
    const m = bol.mensalidade_id ? metaPorMensalidade.get(bol.mensalidade_id) : null;
    const banco = m?.banco ?? 'sicoob';
    const emitenteId = m?.emitenteId ?? null;
    const key = `${banco}:${emitenteId ?? 'none'}`;
    const g = grupos.get(key) ?? { banco, emitenteId, ids: [] };
    g.ids.push(bol.id);
    grupos.set(key, g);
  }

  const { resumoEmailBoletosLote } = await import('@/utils/resumoEmailBoleto');
  const avisos: string[] = [];
  const emails: string[] = [];
  const falhas: { mensalidadeId: string | null; erro: string }[] = [];
  const vistosBoleto = new Set<string>();
  const mensalidadePorBoleto = new Map(
    insertedRows.map((b) => [b.id, b.mensalidade_id] as const),
  );

  const registrarFalhaBoleto = (boletoId: string | null, erro: string) => {
    const texto = erro.trim();
    if (!texto) return;
    if (boletoId) {
      if (vistosBoleto.has(boletoId)) return;
      vistosBoleto.add(boletoId);
    }
    falhas.push({
      mensalidadeId: boletoId ? (mensalidadePorBoleto.get(boletoId) ?? null) : null,
      erro: texto,
    });
  };

  const registrarTextoBoleto = (texto: string, idsGrupo: string[]) => {
    const linhas = texto.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const comId = new Set<string>();
    for (const linha of linhas) {
      const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):\s*([\s\S]+)$/i.exec(
        linha,
      );
      if (m) {
        comId.add(m[1]);
        registrarFalhaBoleto(m[1], m[2]);
      }
    }
    if (!comId.size) {
      for (const id of idsGrupo) registrarFalhaBoleto(id, linhas.join(' ') || texto);
    }
  };

  for (const g of grupos.values()) {
    if (g.banco === 'c6') {
      if (!g.emitenteId) {
        const msg =
          'Falta empresa C6 no cadastro do cliente. Defina a empresa (CNPJ) no cliente ou em Configurações › NFS-e.';
        avisos.push(msg);
        registrarTextoBoleto(msg, g.ids);
        continue;
      }
      try {
        const lote = await emitirBoletosC6Lote(userId, g.emitenteId, g.ids, { modoRapido: true });
        const msg = resumoEmailBoletosLote(lote);
        if (msg) emails.push(msg);
        if (lote.erros?.length) registrarTextoBoleto(lote.erros.join('\n'), g.ids);
        for (const r of lote.resultados ?? []) {
          if (r && r.success === false && r.message) {
            registrarFalhaBoleto(r.boletoId ?? null, r.message);
          }
        }
    } catch (e) {
        const msg =
          (e as Error).message ??
          'Registro C6 pendente. Use “Registrar no C6” na mensalidade.';
        avisos.push(msg);
        registrarTextoBoleto(msg, g.ids);
      }
    } else {
      try {
        const lote = await emitirBoletosSicoobLote(userId, g.ids, { exigirRegistro: true });
        const msg = resumoEmailBoletosLote(lote);
        if (msg) emails.push(msg);
        if (lote.erros?.length) registrarTextoBoleto(lote.erros.join('\n'), g.ids);
        for (const r of lote.resultados ?? []) {
          if (r && r.success === false && r.message) {
            registrarFalhaBoleto(r.boletoId ?? null, r.message);
          }
        }
      } catch (e) {
        const msg =
          (e as Error).message ??
          'Registro bancário Sicoob não concluído; carnê permanece em A receber.';
        avisos.push(msg);
        registrarTextoBoleto(msg, g.ids);
      }
    }
  }

  const avisoBoleto = avisos.length ? avisos.join('\n') : undefined;
  const avisoEmail = emails.length ? emails.join('\n') : undefined;
  return {
    avisoBoleto,
    avisoSicoob: avisoBoleto,
    avisoEmail,
    falhasBoleto: [...falhasDia, ...falhas],
  };
}

/** Carnês já criados que o banco não registrou (timeout 504). Não gera mensalidade de novo. */
export async function registrarBoletosPendentesClientes(
  userId: string,
  clienteIds: string[],
): Promise<{
  avisoBoleto?: string;
  avisoEmail?: string;
  falhasBoleto: { mensalidadeId: string | null; clienteId: string | null; erro: string }[];
}> {
  const vazio = { falhasBoleto: [] as { mensalidadeId: string | null; clienteId: string | null; erro: string }[] };
  if (!clienteIds.length) return vazio;

  const { data: mens, error: eMen } = await supabase
    .from('mensalidades')
    .select('id, cliente_id')
    .eq('user_id', userId)
    .in('cliente_id', clienteIds)
    .in('status', ['pendente', 'atrasado', 'parcial']);
  if (eMen) throw wrapBoletoDbError(eMen);
  const clientePorMensalidade = new Map(
    (mens ?? []).map((m) => [m.id as string, m.cliente_id as string]),
  );
  const idsMen = [...clientePorMensalidade.keys()];
  if (!idsMen.length) return vazio;

  const { data: bols, error: eBol } = await supabase
    .from('boletos_parcela_venda')
    .select('id, mensalidade_id, tipo_emissao, emitente_id, status_registro')
    .eq('user_id', userId)
    .in('mensalidade_id', idsMen)
    .in('status_registro', ['pendente', 'erro']);
  if (eBol) throw wrapBoletoDbError(eBol);
  const rows = (bols ?? []) as {
    id: string;
    mensalidade_id: string | null;
    tipo_emissao: string | null;
    emitente_id: string | null;
  }[];
  if (!rows.length) return vazio;

  const falhasBoleto = rows.map((b) => ({
    mensalidadeId: b.mensalidade_id,
    clienteId: b.mensalidade_id ? (clientePorMensalidade.get(b.mensalidade_id) ?? null) : null,
    erro: 'Reemissão automática desligada. Um novo envio pode gerar outro boleto e outra tarifa no banco.',
  }));
  return {
    avisoBoleto: 'Boletos pendentes não foram reenviados ao banco.',
    falhasBoleto,
  };
}

/** Carnês das mensalidades recentes que foram gravadas sem boleto. Não cria outra mensalidade nem reenvia carnê que já existe. */
export async function sincronizarCarnesMensalidadesFaltantes(
  userId: string,
): Promise<{ gerados: number; falhas: { mensalidadeId: string | null; erro: string }[] }> {
  const desde = new Date();
  desde.setDate(desde.getDate() - 15);
  const { data: mens, error: e0 } = await supabase
    .from('mensalidades')
    .select('id, cliente_id, valor, data_vencimento, competencia')
    .eq('user_id', userId)
    .neq('status', 'cancelado')
    .gte('data_geracao', desde.toISOString());
  if (e0) throw wrapBoletoDbError(e0);
  const todas = (mens ?? []) as MensalidadeParaBoleto[];
  if (!todas.length) return { gerados: 0, falhas: [] };

  const comCarne = new Set<string>();
  for (let i = 0; i < todas.length; i += 80) {
    const ids = todas.slice(i, i + 80).map((m) => m.id);
  const { data: boletos, error: e1 } = await supabase
    .from('boletos_parcela_venda')
    .select('mensalidade_id')
    .eq('user_id', userId)
      .in('mensalidade_id', ids);
  if (e1) throw wrapBoletoDbError(e1);
    for (const b of boletos ?? []) {
      const id = (b as { mensalidade_id: string | null }).mensalidade_id;
      if (id) comCarne.add(id);
    }
  }
  const faltantes = todas.filter((m) => !comCarne.has(m.id));
  if (!faltantes.length) return { gerados: 0, falhas: [] };

  const res = await gerarBoletosParaMensalidades(userId, faltantes);
  return { gerados: faltantes.length, falhas: res.falhasBoleto ?? [] };
}

/** Recria carnês em A receber para vendas que foram salvas sem boleto/carnê. */
export async function sincronizarCarnesVendasFaltantes(
  userId: string,
): Promise<{ gerados: number; falhas: string[] }> {
  const { data: vendas, error: e0 } = await supabase
    .from('vendas')
    .select('id, descricao')
    .eq('user_id', userId)
    .neq('status', 'cancelada');
  if (e0) throw wrapBoletoDbError(e0);
  const vlist = (vendas ?? []) as { id: string; descricao: string }[];
  if (!vlist.length) return { gerados: 0, falhas: [] };

  const boletosPorVenda = new Map<string, Set<string>>();
  const vendaIds = vlist.map((v) => v.id);
  for (let i = 0; i < vendaIds.length; i += 80) {
    const fatia = vendaIds.slice(i, i + 80);
    const { data: boletos, error: e1 } = await supabase
      .from('boletos_parcela_venda')
      .select('venda_id, parcela_id')
      .eq('user_id', userId)
      .in('venda_id', fatia);
    if (e1) throw wrapBoletoDbError(e1);
    for (const b of (boletos ?? []) as { venda_id: string | null; parcela_id: string | null }[]) {
      if (!b.venda_id) continue;
      const set = boletosPorVenda.get(b.venda_id) ?? new Set<string>();
      if (b.parcela_id) set.add(b.parcela_id);
      boletosPorVenda.set(b.venda_id, set);
    }
  }

  const parcPorVenda = new Map<string, string[]>();
  for (let i = 0; i < vendaIds.length; i += 80) {
    const fatia = vendaIds.slice(i, i + 80);
    const { data: parcs, error: e2 } = await supabase
      .from('parcelas_venda')
      .select('id, venda_id')
      .in('venda_id', fatia);
    if (e2) throw new Error(e2.message);
    for (const p of (parcs ?? []) as { id: string; venda_id: string }[]) {
      const arr = parcPorVenda.get(p.venda_id) ?? [];
      arr.push(p.id);
      parcPorVenda.set(p.venda_id, arr);
    }
  }

  let gerados = 0;
  const falhas: string[] = [];
  for (const v of vlist) {
    const todas = parcPorVenda.get(v.id) ?? [];
    if (!todas.length) continue;
    const ja = boletosPorVenda.get(v.id) ?? new Set<string>();
    if (todas.every((id) => ja.has(id))) continue;
    try {
      await gerarBoletosParaVendaCriada(userId, v.id, {
        descricao: v.descricao?.trim() || 'Venda',
      });
      gerados += 1;
    } catch (e) {
      falhas.push((e as Error).message);
    }
  }

  return { gerados, falhas };
}

export async function countBoletosVenda(userId: string, vendaId: string): Promise<number> {
  const { count, error } = await supabase
    .from('boletos_parcela_venda')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('venda_id', vendaId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchBoletosPorVendaId(
  userId: string,
  vendaId: string,
): Promise<BoletoParcelaVendaRow[]> {
  const { data, error } = await supabase
    .from('boletos_parcela_venda')
    .select('*')
    .eq('user_id', userId)
    .eq('venda_id', vendaId)
    .order('numero_parcela', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoletoParcelaVendaRow[];
}

export async function regenerarCarneVenda(
  userId: string,
  vendaId: string,
): Promise<{ avisoBoleto?: string }> {
  const { data: venda, error: e0 } = await supabase
    .from('vendas')
    .select('descricao, status')
    .eq('id', vendaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (e0) throw new Error(e0.message);
  if (!venda) throw new Error('Venda não encontrada.');
  if ((venda as { status: string }).status === 'cancelada') {
    throw new Error('Venda cancelada.');
  }

  return gerarBoletosParaVendaCriada(userId, vendaId, {
    descricao: ((venda as { descricao: string }).descricao ?? '').trim() || 'Venda',
  });
}

async function selectInChunks<T>(ids: string[], run: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  const tamanho = 80;
  for (let i = 0; i < unicos.length; i += tamanho) {
    out.push(...(await run(unicos.slice(i, i + tamanho))));
  }
  return out;
}

const PAGINA_CONTAS_RECEBER = 40;
const STATUS_ABERTO = ['pendente', 'parcial', 'atrasado'];
const STATUS_PAGO = ['pago', 'quitada', 'quitado'];
const STATUS_CANCELADO = ['cancelado', 'cancelada'];

export type ContasReceberConsulta = {
  page?: number;
  search?: string;
  origem?: 'todos' | 'mensalidade' | 'venda';
  situacao?: 'todos' | 'aberto' | 'pago' | 'cancelado';
  vencimentoDe?: string | null;
  vencimentoAte?: string | null;
  pagamentoDe?: string | null;
  pagamentoAte?: string | null;
  /** Código do segmento do cliente. `todos` ou vazio não filtra. */
  segmentoCodigo?: string | null;
  /** Banco do boleto. `todos` inclui também os ainda sem registro. */
  banco?: 'todos' | 'sicoob' | 'c6';
  emitenteId?: string | null;
  /** `pendente` aparece na tela como Registrando. */
  statusRegistro?: 'pendente';
};

export type ContasReceberPagina = {
  rows: ContaReceberListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Soma dos títulos pagos que entram no filtro, em todas as páginas. */
  totalRecebido: number;
};

function statusesDaSituacao(situacao: ContasReceberConsulta['situacao']): string[] | null {
  if (situacao === 'pago') return STATUS_PAGO;
  if (situacao === 'cancelado') return STATUS_CANCELADO;
  if (situacao === 'aberto') return STATUS_ABERTO;
  return null;
}

function textoBusca(valor: string | undefined): string {
  return String(valor ?? '')
    .replace(/[%_,.()]/g, ' ')
    .trim();
}

type TituloFinanceiroRel = {
  status?: string;
  cliente_id?: string;
  data_pagamento?: string | null;
  valor_pago?: number | null;
  desconto?: number | null;
};

type BoletoConsulta = BoletoParcelaVendaRow & {
  mensalidades?: TituloFinanceiroRel | TituloFinanceiroRel[] | null;
  parcelas_venda?: TituloFinanceiroRel | TituloFinanceiroRel[] | null;
};

function umRelacionado<T>(valor: T | T[] | null | undefined): T | null {
  if (!valor) return null;
  return Array.isArray(valor) ? (valor[0] ?? null) : valor;
}

async function hidratarContasReceber(userId: string, brutos: BoletoConsulta[]): Promise<ContaReceberListRow[]> {
  if (!brutos.length) return [];

  const stParcela = new Map<string, string>();
  const stMens = new Map<string, string>();
  const dataPagamentoMens = new Map<string, string>();
  const valorPagoTitulo = new Map<string, number>();
  const descontoTitulo = new Map<string, number>();
  const clientePorMensalidade = new Map<string, string>();
  const clientePorVenda = new Map<string, string>();

  const parcelaSemStatus: string[] = [];
  const mensalidadeSemStatus: string[] = [];
  const vendaSemCliente: string[] = [];

  for (const b of brutos) {
    const men = umRelacionado(b.mensalidades);
    const parc = umRelacionado(b.parcelas_venda);
    if (b.mensalidade_id && men?.status) {
      stMens.set(b.mensalidade_id, men.status);
      valorPagoTitulo.set(b.mensalidade_id, Number(men.valor_pago) || 0);
      descontoTitulo.set(b.mensalidade_id, Number(men.desconto) || 0);
    } else if (b.mensalidade_id) mensalidadeSemStatus.push(b.mensalidade_id);
    if (b.mensalidade_id && men?.data_pagamento) {
      dataPagamentoMens.set(b.mensalidade_id, String(men.data_pagamento).slice(0, 10));
    }
    if (men?.cliente_id && b.mensalidade_id) clientePorMensalidade.set(b.mensalidade_id, men.cliente_id);
    if (b.parcela_id && parc?.status) {
      stParcela.set(b.parcela_id, parc.status);
      valorPagoTitulo.set(b.parcela_id, Number(parc.valor_pago) || 0);
      descontoTitulo.set(b.parcela_id, Number(parc.desconto) || 0);
    } else if (b.parcela_id) parcelaSemStatus.push(b.parcela_id);
    if (b.venda_id && !b.mensalidade_id) vendaSemCliente.push(b.venda_id);
  }

  const parcs = await selectInChunks(parcelaSemStatus, async (slice) => {
    const { data, error } = await supabase
      .from('parcelas_venda')
      .select('id, status, valor_pago, desconto')
      .in('id', slice);
    if (error) throw new Error(error.message);
    return (data ?? []) as {
      id: string;
      status: string;
      valor_pago?: number;
      desconto?: number;
    }[];
  });
  for (const p of parcs) {
    stParcela.set(p.id, p.status);
    valorPagoTitulo.set(p.id, Number(p.valor_pago) || 0);
    descontoTitulo.set(p.id, Number(p.desconto) || 0);
  }

  const mens = await selectInChunks(mensalidadeSemStatus, async (slice) => {
    const { data, error } = await supabase
      .from('mensalidades')
      .select('id, status, cliente_id, data_pagamento, valor_pago, desconto')
      .in('id', slice);
    if (error) throw new Error(error.message);
    return (data ?? []) as {
      id: string;
      status: string;
      cliente_id: string;
      data_pagamento: string | null;
      valor_pago?: number;
      desconto?: number;
    }[];
  });
  for (const m of mens) {
    stMens.set(m.id, m.status);
    clientePorMensalidade.set(m.id, m.cliente_id);
    valorPagoTitulo.set(m.id, Number(m.valor_pago) || 0);
    descontoTitulo.set(m.id, Number(m.desconto) || 0);
    if (m.data_pagamento) dataPagamentoMens.set(m.id, String(m.data_pagamento).slice(0, 10));
  }

  const vendas = await selectInChunks(vendaSemCliente, async (slice) => {
    const { data, error } = await supabase.from('vendas').select('id, cliente_id').in('id', slice);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; cliente_id: string }[];
  });
  for (const v of vendas) clientePorVenda.set(v.id, v.cliente_id);

  const clientePorBoleto = new Map<string, string>();
  for (const b of brutos) {
    if (b.mensalidade_id) {
      const cid = clientePorMensalidade.get(b.mensalidade_id);
      if (cid) clientePorBoleto.set(b.id, cid);
    } else if (b.venda_id) {
      const cid = clientePorVenda.get(b.venda_id);
      if (cid) clientePorBoleto.set(b.id, cid);
    }
  }

  const clienteIds = [...new Set(clientePorBoleto.values())];
  const segmentoPorCliente = new Map<string, { codigo: string; nome: string }>();
  const whatsappPorCliente = new Map<string, { valor: string; nome: string }>();
  const emailPorCliente = new Map<string, { valor: string; nome: string }>();
  if (clienteIds.length) {
    const nomesSegmento = await getSegmentoNomePorCodigo();
    const clientesSeg = await selectInChunks(clienteIds, async (slice) => {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, segmento_cliente_codigo')
        .in('id', slice);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string | number; segmento_cliente_codigo: string | null }[];
    });
    for (const c of clientesSeg) {
      const codigo = (c.segmento_cliente_codigo ?? '').trim();
      if (!codigo) continue;
      segmentoPorCliente.set(String(c.id), { codigo, nome: nomesSegmento.get(codigo) || codigo });
    }

    const contatos = await selectInChunks(clienteIds, async (slice) => {
      const { data, error: e5 } = await supabase
      .from('contatos_cliente')
        .select('cliente_id, valor_contato, nome_contato, tipo_contato')
        .in('cliente_id', slice)
        .in('tipo_contato', ['whatsapp', 'email'])
      .order('created_at', { ascending: true });
    if (e5) throw new Error(e5.message);
      return (data ?? []) as {
        cliente_id: string;
        valor_contato: string;
        nome_contato: string;
        tipo_contato: string;
      }[];
    });
    for (const c of contatos) {
      if (c.tipo_contato === 'whatsapp' && !whatsappPorCliente.has(c.cliente_id)) {
        whatsappPorCliente.set(c.cliente_id, { valor: c.valor_contato, nome: c.nome_contato });
      }
      if (c.tipo_contato === 'email') {
        const email = String(c.valor_contato ?? '').trim();
        if (!email) continue;
        const atual = emailPorCliente.get(c.cliente_id);
        if (!atual) {
          emailPorCliente.set(c.cliente_id, { valor: email, nome: c.nome_contato });
        } else if (!atual.valor.toLowerCase().split(', ').includes(email.toLowerCase())) {
          atual.valor = `${atual.valor}, ${email}`;
        }
      }
    }
  }

  const mensalidadeIds = brutos.map((b) => b.mensalidade_id).filter((id): id is string => Boolean(id));
  const vendaIds = brutos.map((b) => b.venda_id).filter((id): id is string => Boolean(id));
  const nfPorMensalidade = new Map<string, { id: string }>();
  const nfPorVenda = new Map<string, { id: string }>();
  const nfMens = await selectInChunks(mensalidadeIds, async (slice) => {
    const map = await fetchNotasFiscaisPorMensalidadeIds(userId, slice).catch(() => new Map());
    return [...map.entries()];
  });
  for (const [id, nota] of nfMens) {
    if (!nfPorMensalidade.has(id)) nfPorMensalidade.set(id, nota);
  }
  const nfVendas = await selectInChunks(vendaIds, async (slice) => {
    const map = await fetchNotasFiscaisPorVendaIds(userId, slice).catch(() => new Map());
    return [...map.entries()];
  });
  for (const [id, nota] of nfVendas) {
    if (!nfPorVenda.has(id)) nfPorVenda.set(id, nota);
  }

  return brutos.map((b) => {
    const { mensalidades: _m, parcelas_venda: _p, ...boleto } = b;
    const isMen = boleto.origem === 'mensalidade' || Boolean(boleto.mensalidade_id);
    const status = isMen
      ? (stMens.get(boleto.mensalidade_id ?? '') ?? '—')
      : (stParcela.get(boleto.parcela_id ?? '') ?? '—');

    let referencia_label: string;
    if (isMen) {
      const linha = String(boleto.venda_descricao_resumo ?? '')
        .split('\n')
        .find((l) => l.startsWith('Competência:'));
      referencia_label = linha
        ? `Mensalidade · ${linha.replace('Competência: ', '').trim()}`
        : 'Mensalidade recorrente';
    } else {
      referencia_label = `Venda · parcela ${boleto.numero_parcela}/${boleto.total_parcelas_venda}`;
    }

    const clienteId = clientePorBoleto.get(boleto.id) ?? null;
    const seg = clienteId ? segmentoPorCliente.get(String(clienteId)) : undefined;
    const wa = clienteId ? whatsappPorCliente.get(clienteId) : undefined;
    const em = clienteId ? emailPorCliente.get(clienteId) : undefined;

    let nota_fiscal_id = boleto.nota_fiscal_id;
    if (!nota_fiscal_id && boleto.mensalidade_id) {
      nota_fiscal_id = nfPorMensalidade.get(boleto.mensalidade_id)?.id ?? null;
    }
    if (!nota_fiscal_id && boleto.venda_id) {
      nota_fiscal_id = nfPorVenda.get(boleto.venda_id)?.id ?? null;
    }

    const tituloId = isMen ? boleto.mensalidade_id : boleto.parcela_id;
    const valorPago = tituloId ? valorPagoTitulo.get(tituloId) ?? 0 : 0;
    const desconto = tituloId ? descontoTitulo.get(tituloId) ?? 0 : 0;

    return {
      ...boleto,
      nota_fiscal_id,
      origem: isMen ? 'mensalidade' : 'venda',
      parcela_status: boleto.status_registro === 'pago' || status === 'pago' ? 'pago' : status,
      situacao_cobranca:
        boleto.status_registro === 'pago' || status === 'pago' || status === 'quitada' || status === 'quitado'
          ? 'pago'
          : boleto.status_registro === 'baixado'
            ? 'cancelado'
            : situacaoCobrancaDeStatus(status),
      nome_cliente: String(boleto.pagador_nome || '—'),
      referencia_label,
      cliente_id: clienteId == null ? null : String(clienteId),
      whatsapp: wa?.valor ?? null,
      whatsapp_contato_nome: wa?.nome ?? null,
      email: em?.valor ?? null,
      email_contato_nome: em?.nome ?? null,
      data_pagamento:
        (boleto.data_liquidacao_sicoob ? String(boleto.data_liquidacao_sicoob).slice(0, 10) : null) ||
        (boleto.mensalidade_id ? dataPagamentoMens.get(boleto.mensalidade_id) ?? null : null),
      valor_pago: valorPago,
      desconto,
      segmento_codigo: seg?.codigo ?? null,
      segmento_nome: seg?.nome ?? null,
    };
  });
}

function aplicarFiltrosBoleto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  userId: string,
  opts: ContasReceberConsulta,
  lado?: 'mensalidade' | 'venda',
) {
  let query = q.eq('user_id', userId);
  if (lado) query = query.eq('origem', lado);
  else if (opts.origem && opts.origem !== 'todos') query = query.eq('origem', opts.origem);
  if (opts.emitenteId) query = query.eq('emitente_id', opts.emitenteId);
  if (opts.banco === 'sicoob' || opts.banco === 'c6') query = query.eq('tipo_emissao', opts.banco);
  if (opts.statusRegistro) query = query.eq('status_registro', opts.statusRegistro);
  if (opts.vencimentoDe) query = query.gte('data_vencimento', opts.vencimentoDe);
  if (opts.vencimentoAte) query = query.lte('data_vencimento', opts.vencimentoAte);
  if (opts.pagamentoDe) query = query.gte('data_liquidacao_sicoob', opts.pagamentoDe);
  if (opts.pagamentoAte) query = query.lte('data_liquidacao_sicoob', opts.pagamentoAte);
  const busca = textoBusca(opts.search);
  if (busca) {
    query = query.or(
      `pagador_nome.ilike.%${busca}%,numero_documento.ilike.%${busca}%,venda_descricao_resumo.ilike.%${busca}%`,
    );
  }
  return query;
}

type ChaveLista = {
  id: string;
  pagador_nome?: string | null;
  data_vencimento?: string | null;
  valor_documento?: number | null;
  mensalidades?: TituloFinanceiroRel | TituloFinanceiroRel[] | null;
  parcelas_venda?: TituloFinanceiroRel | TituloFinanceiroRel[] | null;
};

/** Valor efetivamente recebido: valor_pago do título; fallback no valor do documento. */
function valorRecebidoChave(row: ChaveLista, lado: 'mensalidade' | 'venda'): number {
  const rel =
    lado === 'venda' ? umRelacionado(row.parcelas_venda) : umRelacionado(row.mensalidades);
  const pago = Number(rel?.valor_pago) || 0;
  if (pago > 0) return pago;
  return Number(row.valor_documento) || 0;
}

function ordenarChaves(a: ChaveLista, b: ChaveLista): number {
  const nome = String(a.pagador_nome ?? '').localeCompare(String(b.pagador_nome ?? ''), 'pt-BR');
  if (nome) return nome;
  const data = String(a.data_vencimento ?? '').localeCompare(String(b.data_vencimento ?? ''));
  if (data) return data;
  return String(a.id).localeCompare(String(b.id));
}

async function listarChavesPagas(
  userId: string,
  lado: 'mensalidade' | 'venda',
  opts: ContasReceberConsulta,
): Promise<ChaveLista[]> {
  const segmento =
    opts.segmentoCodigo && opts.segmentoCodigo !== 'todos' ? opts.segmentoCodigo.trim() : null;
  const rel = lado === 'venda' ? 'parcelas_venda.status' : 'mensalidades.status';
  const select =
    lado === 'venda'
      ? `id, pagador_nome, data_vencimento, valor_documento, parcelas_venda!inner(status, valor_pago, desconto)${
          segmento ? ', vendas!inner(clientes!inner(segmento_cliente_codigo))' : ''
        }`
      : `id, pagador_nome, data_vencimento, valor_documento, mensalidades!inner(status, valor_pago, desconto${
          segmento ? ', clientes!inner(segmento_cliente_codigo)' : ''
        })`;

  const base = () => {
    let q = aplicarFiltrosBoleto(
      supabase.from('boletos_parcela_venda').select(select),
      userId,
      opts,
      lado,
    );
    if (segmento) {
      q = q.eq(
        lado === 'venda'
          ? 'vendas.clientes.segmento_cliente_codigo'
          : 'mensalidades.clientes.segmento_cliente_codigo',
        segmento,
      );
    }
    return q;
  };

  const buscar = async (montar: () => ReturnType<typeof base>) => {
    const out: ChaveLista[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await montar().range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as ChaveLista[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };

  const [peloBanco, peloTitulo] = await Promise.all([
    buscar(() => base().eq('status_registro', 'pago')),
    buscar(() => base().in(rel, STATUS_PAGO).neq('status_registro', 'pago')),
  ]);
  const unicos = new Map<string, ChaveLista>();
  for (const row of [...peloBanco, ...peloTitulo]) unicos.set(row.id, row);
  return [...unicos.values()].sort(ordenarChaves);
}

async function listarChavesLado(
  userId: string,
  lado: 'mensalidade' | 'venda',
  opts: ContasReceberConsulta,
): Promise<ChaveLista[]> {
  if (opts.situacao === 'pago') return listarChavesPagas(userId, lado, opts);

  const statuses = statusesDaSituacao(opts.situacao);
  const segmento =
    opts.segmentoCodigo && opts.segmentoCodigo !== 'todos' ? opts.segmentoCodigo.trim() : null;
  const filtrarParcelaNoApp = lado === 'venda' && Boolean(statuses);
  const select =
    lado === 'venda'
      ? `id, pagador_nome, data_vencimento, valor_documento, parcelas_venda(status)${
          segmento ? ', vendas!inner(clientes!inner(segmento_cliente_codigo))' : ''
        }`
      : `id, pagador_nome, data_vencimento, valor_documento, mensalidades${
          statuses || segmento ? '!inner' : ''
        }(status, cliente_id, data_pagamento${
          segmento ? ', clientes!inner(segmento_cliente_codigo)' : ''
        })`;

  const montar = () => {
    let q = aplicarFiltrosBoleto(
      supabase.from('boletos_parcela_venda').select(select),
      userId,
      opts,
      lado,
    );
    if (segmento) {
      q = q.eq(
        lado === 'venda'
          ? 'vendas.clientes.segmento_cliente_codigo'
          : 'mensalidades.clientes.segmento_cliente_codigo',
        segmento,
      );
    }
    if (statuses && !filtrarParcelaNoApp) {
      q = q.in('mensalidades.status', statuses);
      if (opts.situacao === 'aberto') q = q.neq('status_registro', 'pago');
    } else if (opts.situacao === 'aberto') {
      q = q.neq('status_registro', 'pago');
    }
    return q
      .order('pagador_nome', { ascending: true })
      .order('data_vencimento', { ascending: true })
      .order('id', { ascending: true });
  };

  const out: ChaveLista[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await montar().range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as (ChaveLista & {
      parcelas_venda?: { status?: string } | { status?: string }[] | null;
    })[];
    for (const row of rows) {
      if (filtrarParcelaNoApp && statuses) {
        const rel = row.parcelas_venda;
        const st = Array.isArray(rel) ? rel[0]?.status : rel?.status;
        if (st && STATUS_CANCELADO.includes(st)) continue;
        if (opts.situacao === 'aberto' && st && STATUS_PAGO.includes(st)) continue;
        if (opts.situacao === 'cancelado' && st && !STATUS_CANCELADO.includes(st)) continue;
      }
      out.push(row);
    }
    if (!data || data.length < 1000) break;
  }
  return out.sort(ordenarChaves);
}

async function buscarBoletosPorIds(userId: string, ids: string[]): Promise<BoletoConsulta[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('boletos_parcela_venda')
    .select(
      '*, mensalidades(status, cliente_id, data_pagamento, valor_pago, desconto), parcelas_venda(status, valor_pago, desconto)',
    )
    .eq('user_id', userId)
    .in('id', ids);
  if (error) throw new Error(error.message);
  const porId = new Map(((data ?? []) as BoletoConsulta[]).map((row) => [row.id, row]));
  return ids.map((id) => porId.get(id)).filter((row): row is BoletoConsulta => Boolean(row));
}

async function consultarLado(
  userId: string,
  lado: 'mensalidade' | 'venda',
  opts: ContasReceberConsulta,
  from: number,
  to: number,
): Promise<{ rows: BoletoConsulta[]; total: number }> {
  const chaves = await listarChavesLado(userId, lado, opts);
  const pagina = chaves.slice(from, to + 1);
  if (!pagina.length) return { rows: [], total: chaves.length };
  return {
    rows: await buscarBoletosPorIds(
      userId,
      pagina.map((c) => c.id),
    ),
    total: chaves.length,
  };
}

async function somarRecebido(userId: string, opts: ContasReceberConsulta): Promise<number> {
  const optsPago: ContasReceberConsulta = {
    ...opts,
    situacao: 'pago',
    statusRegistro: undefined,
  };
  const lados: Array<'mensalidade' | 'venda'> =
    optsPago.origem === 'venda' || optsPago.origem === 'mensalidade'
      ? [optsPago.origem]
      : ['mensalidade', 'venda'];
  let soma = 0;
  for (const lado of lados) {
    const chaves = await listarChavesPagas(userId, lado, optsPago);
    for (const row of chaves) soma += valorRecebidoChave(row, lado);
  }
  return Math.round(soma * 100) / 100;
}

export async function fetchContasReceberPagina(
  userId: string,
  opts: ContasReceberConsulta = {},
): Promise<ContasReceberPagina> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = PAGINA_CONTAS_RECEBER;
  const totalRecebido = await somarRecebido(userId, opts);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const origem = opts.origem ?? 'todos';

  if (origem === 'mensalidade' || origem === 'venda') {
    const { rows, total } = await consultarLado(userId, origem, opts, from, to);
    return { rows: await hidratarContasReceber(userId, rows), total, page, pageSize, totalRecebido };
  }

  const [chavesM, chavesV] = await Promise.all([
    listarChavesLado(userId, 'mensalidade', opts),
    listarChavesLado(userId, 'venda', opts),
  ]);
  const chaves = [...chavesM, ...chavesV].sort(ordenarChaves);
  const pagina = chaves.slice(from, to + 1);
  return {
    rows: await hidratarContasReceber(
      userId,
      await buscarBoletosPorIds(
        userId,
        pagina.map((c) => c.id),
      ),
    ),
    total: chaves.length,
    page,
    pageSize,
    totalRecebido,
  };
}

export async function fetchContasReceberLista(userId: string): Promise<ContaReceberListRow[]> {
  const primeira = await fetchContasReceberPagina(userId, { page: 1, situacao: 'todos', origem: 'todos' });
  const rows = [...primeira.rows];
  const paginas = Math.ceil(primeira.total / primeira.pageSize);
  for (let page = 2; page <= paginas; page += 1) {
    const proxima = await fetchContasReceberPagina(userId, { page, situacao: 'todos', origem: 'todos' });
    rows.push(...proxima.rows);
  }
  return rows;
}

export async function fetchBoletoParcelaById(
  userId: string,
  boletoId: string,
): Promise<BoletoParcelaVendaRow | null> {
  const { data, error } = await supabase
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoletoParcelaVendaRow | null) ?? null;
}

/** Mapa mensalidade_id → boleto (primeiro encontrado). */
export async function fetchBoletosPorMensalidadeIds(
  userId: string,
  mensalidadeIds: string[],
): Promise<Record<string, BoletoParcelaVendaRow>> {
  const ids = [...new Set(mensalidadeIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('boletos_parcela_venda')
    .select('*')
    .eq('user_id', userId)
    .in('mensalidade_id', ids);
  if (error) throw new Error(error.message);
  const map: Record<string, BoletoParcelaVendaRow> = {};
  for (const row of (data ?? []) as BoletoParcelaVendaRow[]) {
    if (row.mensalidade_id && !map[row.mensalidade_id]) {
      map[row.mensalidade_id] = row;
    }
  }
  return map;
}
