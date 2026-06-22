import { supabase } from '@/lib/supabase';
import { fetchPerfilCobranca } from '@/services/perfilCobrancaService';
import type { BoletoParcelaVendaRow, ContaReceberListRow, PerfilCobranca } from '@/types/contasReceber';
import { situacaoCobrancaDeStatus } from '@/utils/contaReceberCobranca';
import { CLIENTE_EMBED_SELECT, mapClienteEnderecoFiscal, type ClienteDbRow } from '@/utils/clientesDbMapping';
import { clienteDocFiscal } from '@/utils/cnpj';
import { toISODate } from '@/utils/date';

const SQL_MIGRATION_018_HINT =
  'Execute no Supabase (SQL Editor) o arquivo supabase/migrations/018_boletos_mensalidade_contas_receber.sql — ' +
  'se já tentou antes, rode também 019_boletos_mensalidade_repair.sql.';

function wrapBoletoDbError(error: { message?: string } | null): Error {
  const msg = error?.message ?? 'Erro ao gravar carnê em contas a receber.';
  if (/mensalidade_id|origem|chk_boletos_parc_origem/i.test(msg)) {
    return new Error(`${SQL_MIGRATION_018_HINT}\n\n${msg}`);
  }
  return new Error(msg);
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
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!cliente) throw new Error('Cliente não encontrado para gerar boleto.');
  return mapClienteEnderecoFiscal(cliente as ClienteDbRow);
}

async function buildSnapshotBenefPag(
  userId: string,
  clienteId: string,
): Promise<SnapshotBenefPag> {
  const cli = await fetchClienteAddr(userId, clienteId);
  const perfil = await fetchPerfilCobranca(userId).catch(() => null);
  const hoje = toISODate(new Date());

  const benefRazao = (perfil?.razao_social ?? '').trim() || PLACEHOLDER_BENEF;
  const benefDoc = (perfil?.documento ?? '').trim() || '—';
  const benefEnd =
    perfil && (perfil.logradouro.trim() || perfil.numero.trim())
      ? linhaEnderecoBenef(perfil)
      : '—';
  const benefBairro = (perfil?.bairro ?? '').trim() || '—';
  const benefCidade =
    perfil && (perfil.cidade.trim() || perfil.uf.trim())
      ? cidadeUfCepBenef({
          cidade: perfil.cidade,
          uf: perfil.uf,
          cep: perfil.cep,
          bairro: perfil.bairro,
        })
      : '—';

  const pagNome = trimJoin(
    [cli.nome_cliente, cli.nome_empresa ? `(${cli.nome_empresa})` : ''],
    ' ',
  );

  return {
    beneficiario_razao_social: benefRazao,
    beneficiario_documento: benefDoc,
    beneficiario_endereco: benefEnd,
    beneficiario_bairro: benefBairro,
    beneficiario_cidade_uf_cep: benefCidade,
    pagador_nome: pagNome || '—',
    pagador_documento: clienteDocFiscal(cli) || '—',
    pagador_endereco: linhaEnderecoCliente(cli) || '—',
    pagador_cidade_uf_cep: cidadeUfCepCliente(cli) || '—',
    mensagem_pagador: (perfil?.mensagem_padrao_pagador ?? '').trim() || null,
    local_pagamento:
      (perfil?.local_pagamento ?? '').trim() || 'PAGÁVEL PREFERENCIALMENTE NOS CANAIS DO SEU BANCO',
    cooperativa_rodape: (perfil?.cooperativa_nome ?? '').trim() || null,
    data_documento: hoje,
  };
}

/** Chamado logo após inserir parcelas da venda. */
export async function gerarBoletosParaVendaCriada(
  userId: string,
  vendaId: string,
  opts: { descricao: string },
): Promise<void> {
  const { data: venda, error: e0 } = await supabase
    .from('vendas')
    .select('cliente_id')
    .eq('id', vendaId)
    .eq('user_id', userId)
    .maybeSingle();

  if (e0) throw new Error(e0.message);
  if (!venda) throw new Error('Venda não encontrada para gerar boletos.');

  const clienteId = (venda as { cliente_id: string }).cliente_id;
  const snap = await buildSnapshotBenefPag(userId, clienteId);
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

  const total = plist.length;
  const rows = plist.map((p) => {
    const descResumo = `${opts.descricao.trim()}\nParcela ${p.numero_parcela} de ${total}.`;
    return {
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
    };
  });

  const { error: e3 } = await supabase.from('boletos_parcela_venda').insert(rows);
  if (e3) throw wrapBoletoDbError(e3);
}

export type MensalidadeParaBoleto = {
  id: string;
  cliente_id: string;
  valor: number;
  data_vencimento: string;
  competencia: string | null;
};

/** Um carnê em contas a receber por mensalidade gerada. */
export async function gerarBoletosParaMensalidades(
  userId: string,
  mensalidades: MensalidadeParaBoleto[],
): Promise<void> {
  if (!mensalidades.length) return;

  const perfil = await fetchPerfilCobranca(userId).catch(() => null);
  const snapCache = new Map<string, SnapshotBenefPag>();
  const rows: Record<string, unknown>[] = [];

  for (const m of mensalidades) {
    let snap = snapCache.get(m.cliente_id);
    if (!snap) {
      snap = await buildSnapshotBenefPag(userId, m.cliente_id);
      snapCache.set(m.cliente_id, snap);
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
    });
  }

  const { error } = await supabase.from('boletos_parcela_venda').insert(rows);
  if (error) throw wrapBoletoDbError(error);
}

/** Recria carnês em A receber para mensalidades que foram geradas sem boleto (ex.: falha na migration 018). */
export async function sincronizarCarnesMensalidadesFaltantes(
  userId: string,
): Promise<{ gerados: number }> {
  const { data: mens, error: e0 } = await supabase
    .from('mensalidades')
    .select('id, cliente_id, valor, data_vencimento, competencia')
    .eq('user_id', userId);
  if (e0) throw wrapBoletoDbError(e0);
  const todas = (mens ?? []) as MensalidadeParaBoleto[];
  if (!todas.length) return { gerados: 0 };

  const { data: boletos, error: e1 } = await supabase
    .from('boletos_parcela_venda')
    .select('mensalidade_id')
    .eq('user_id', userId)
    .not('mensalidade_id', 'is', null);
  if (e1) throw wrapBoletoDbError(e1);

  const comCarne = new Set(
    ((boletos ?? []) as { mensalidade_id: string | null }[])
      .map((b) => b.mensalidade_id)
      .filter((id): id is string => Boolean(id)),
  );
  const faltantes = todas.filter((m) => !comCarne.has(m.id));
  if (!faltantes.length) return { gerados: 0 };

  await gerarBoletosParaMensalidades(userId, faltantes);
  return { gerados: faltantes.length };
}

export async function fetchContasReceberLista(userId: string): Promise<ContaReceberListRow[]> {
  const { data: boletos, error } = await supabase
    .from('boletos_parcela_venda')
    .select('*')
    .eq('user_id', userId)
    .order('data_vencimento', { ascending: true });

  if (error) throw new Error(error.message);
  const blist = (boletos ?? []) as BoletoParcelaVendaRow[];
  if (!blist.length) return [];

  const parcelaIds = blist.map((b) => b.parcela_id).filter((id): id is string => Boolean(id));
  const mensalidadeIds = blist
    .map((b) => b.mensalidade_id)
    .filter((id): id is string => Boolean(id));

  const stParcela = new Map<string, string>();
  if (parcelaIds.length) {
    const { data: parcs, error: e2 } = await supabase
      .from('parcelas_venda')
      .select('id, status')
      .in('id', parcelaIds);
    if (e2) throw new Error(e2.message);
    for (const p of (parcs as { id: string; status: string }[] | null) ?? []) {
      stParcela.set(p.id, p.status);
    }
  }

  const stMens = new Map<string, string>();
  const clientePorMensalidade = new Map<string, string>();
  if (mensalidadeIds.length) {
    const { data: mens, error: e3 } = await supabase
      .from('mensalidades')
      .select('id, status, cliente_id')
      .in('id', mensalidadeIds);
    if (e3) throw new Error(e3.message);
    for (const m of (mens as { id: string; status: string; cliente_id: string }[] | null) ?? []) {
      stMens.set(m.id, m.status);
      clientePorMensalidade.set(m.id, m.cliente_id);
    }
  }

  const vendaIds = blist.map((b) => b.venda_id).filter((id): id is string => Boolean(id));
  const clientePorVenda = new Map<string, string>();
  if (vendaIds.length) {
    const { data: vendas, error: e4 } = await supabase
      .from('vendas')
      .select('id, cliente_id')
      .in('id', vendaIds);
    if (e4) throw new Error(e4.message);
    for (const v of (vendas as { id: string; cliente_id: string }[] | null) ?? []) {
      clientePorVenda.set(v.id, v.cliente_id);
    }
  }

  const clientePorBoleto = new Map<string, string>();
  for (const b of blist) {
    if (b.mensalidade_id) {
      const cid = clientePorMensalidade.get(b.mensalidade_id);
      if (cid) clientePorBoleto.set(b.id, cid);
    } else if (b.venda_id) {
      const cid = clientePorVenda.get(b.venda_id);
      if (cid) clientePorBoleto.set(b.id, cid);
    }
  }

  const clienteIds = [...new Set(clientePorBoleto.values())];
  const whatsappPorCliente = new Map<string, { valor: string; nome: string }>();
  if (clienteIds.length) {
    const { data: contatos, error: e5 } = await supabase
      .from('contatos_cliente')
      .select('cliente_id, valor_contato, nome_contato')
      .in('cliente_id', clienteIds)
      .eq('tipo_contato', 'whatsapp')
      .order('created_at', { ascending: true });
    if (e5) throw new Error(e5.message);
    for (const c of (contatos as { cliente_id: string; valor_contato: string; nome_contato: string }[] | null) ??
      []) {
      if (!whatsappPorCliente.has(c.cliente_id)) {
        whatsappPorCliente.set(c.cliente_id, {
          valor: c.valor_contato,
          nome: c.nome_contato,
        });
      }
    }
  }

  return blist.map((b) => {
    const isMen = b.origem === 'mensalidade' || Boolean(b.mensalidade_id);
    const status = isMen
      ? stMens.get(b.mensalidade_id ?? '') ?? '—'
      : stParcela.get(b.parcela_id ?? '') ?? '—';

    let referencia_label: string;
    if (isMen) {
      const linha = b.venda_descricao_resumo.split('\n').find((l) => l.startsWith('Competência:'));
      referencia_label = linha
        ? `Mensalidade · ${linha.replace('Competência: ', '').trim()}`
        : 'Mensalidade recorrente';
    } else {
      referencia_label = `Venda · parcela ${b.numero_parcela}/${b.total_parcelas_venda}`;
    }

    const clienteId = clientePorBoleto.get(b.id) ?? null;
    const wa = clienteId ? whatsappPorCliente.get(clienteId) : undefined;

    return {
      ...b,
      origem: isMen ? 'mensalidade' : 'venda',
      parcela_status: status,
      situacao_cobranca: situacaoCobrancaDeStatus(status),
      nome_cliente: b.pagador_nome || '—',
      referencia_label,
      cliente_id: clienteId,
      whatsapp: wa?.valor ?? null,
      whatsapp_contato_nome: wa?.nome ?? null,
    };
  });
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
