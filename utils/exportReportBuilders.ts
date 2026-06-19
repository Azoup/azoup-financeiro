import type { ExportReportPayload } from '@/types/exportReport';
import type { ContaReceberListRow } from '@/types/contasReceber';
import type { MensalidadeGerada } from '@/types/mensalidadeGerada';
import type { ClienteFormValues, ClienteListItem, SegmentoClienteRow } from '@/types/models';
import type { PerfilCobrancaInput } from '@/types/contasReceber';
import type { VendaDetail, VendaFinanceiroStats, VendaListRow } from '@/types/vendas';
import type { ClienteSituacaoFiltro } from '@/services/clientsService';
import { formatBRL } from '@/utils/currency';
import { formatBRDate, formatDateTimeBRFromISO, parseISODate } from '@/utils/date';
import { vendaDescricaoResumo } from '@/utils/vendasDescricao';
import { mensalidadeGeradaStatusVisual } from '@/services/mensalidadeGeradaService';
import { labelSituacaoCobranca } from '@/utils/contaReceberCobranca';
import { parcelaStatusVisual } from '@/services/vendasService';
import type { Cliente, ContatoCliente } from '@/types/models';

function kvSection(title: string, items: { label: string; value: string }[]) {
  return { kind: 'kv' as const, title, items };
}

function tableSection(title: string, columns: string[], rows: string[][]) {
  return { kind: 'table' as const, title, columns, rows };
}

function sheetFromTable(name: string, columns: string[], rows: string[][]) {
  return { name, columns, rows: rows.map((r) => r) };
}

export function buildClientsListExport(
  items: ClienteListItem[],
  opts: { search: string; situacao: ClienteSituacaoFiltro; sortLabel: string },
): ExportReportPayload {
  const columns = [
    'Cliente',
    'Empresa',
    'Documento',
    'CNPJ',
    'Segmento',
    'Mensalidade',
    'Situação',
    'Contatos',
    'Cadastro',
  ];
  const rows = items.map((c) => [
    c.nome_cliente,
    c.nome_empresa ?? '',
    c.documento,
    c.cnpj?.trim() ?? '',
    c.segmento_cliente?.nome ?? c.segmento_cliente_codigo ?? '',
    formatBRL(c.valor_mensalidade),
    c.cancelado ? 'Cancelado' : 'Ativo',
    String(c.contatos_count ?? 0),
    formatDateTimeBRFromISO(c.created_at) || '',
  ]);

  return {
    title: 'Clientes',
    subtitle: `Filtros: busca "${opts.search || '—'}" · situação ${opts.situacao} · ordenação ${opts.sortLabel}`,
    sections: [
      kvSection('Resumo', [
        { label: 'Total de registros', value: String(items.length) },
        { label: 'Ativos', value: String(items.filter((c) => !c.cancelado).length) },
        { label: 'Cancelados', value: String(items.filter((c) => c.cancelado).length) },
      ]),
      tableSection('Lista de clientes', columns, rows),
    ],
    sheets: [sheetFromTable('Clientes', columns, rows)],
  };
}

export function buildClientDetailExport(
  data: Cliente & { contatos_cliente: ContatoCliente[] },
  mensalidades: MensalidadeGerada[],
): ExportReportPayload {
  const contatosRows = data.contatos_cliente.map((c) => [
    c.nome_contato,
    c.tipo_contato === 'email' ? 'E-mail' : 'WhatsApp',
    c.valor_contato,
    formatDateTimeBRFromISO(c.created_at) || '',
  ]);

  const mensRows = mensalidades.map((m) => [
    m.competencia ?? '—',
    m.data_vencimento.split('-').reverse().join('/'),
    formatBRL(m.valor),
    formatBRL(m.valor_pago),
    mensalidadeGeradaStatusVisual(m),
  ]);

  const sections: ExportReportPayload['sections'] = [
    kvSection('Situação', [
      { label: 'Status', value: data.cancelado ? 'Cancelado' : 'Ativo' },
      {
        label: 'Motivo cancelamento',
        value: data.ultima_justificativa_cancelamento?.trim() || '—',
      },
    ]),
    kvSection('Dados principais', [
      { label: 'Documento', value: data.documento },
      { label: 'CNPJ', value: data.cnpj?.trim() || '—' },
      { label: 'Inscrição estadual', value: data.inscricao_estadual?.trim() || '—' },
      { label: 'Cliente', value: data.nome_cliente },
      { label: 'Empresa', value: data.nome_empresa ?? '—' },
      { label: 'Segmento', value: data.segmento_cliente?.nome ?? data.segmento_cliente_codigo ?? '—' },
      { label: 'NF', value: data.emite_nf ? 'Com NF' : 'Sem NF' },
      { label: 'Cadastro', value: formatDateTimeBRFromISO(data.created_at) || '—' },
    ]),
    kvSection('Endereço', [
      { label: 'CEP', value: data.cep ?? '—' },
      { label: 'Logradouro', value: data.logradouro ?? '—' },
      { label: 'Número', value: data.numero ?? '—' },
      { label: 'Cidade/UF', value: `${data.cidade ?? ''} / ${data.uf ?? ''}`.trim() || '—' },
    ]),
    kvSection('Financeiro', [
      { label: 'Mês entrada', value: data.mes_entrada ?? '—' },
      { label: 'Mensalidade atual', value: formatBRL(data.valor_mensalidade) },
      {
        label: 'Mensalidade anterior',
        value:
          data.valor_mensalidade_anterior != null ? formatBRL(data.valor_mensalidade_anterior) : '—',
      },
      { label: 'Primeiro vencimento', value: formatBRDate(parseISODate(data.data_inicio)) || '—' },
      { label: 'Data reajuste', value: formatBRDate(parseISODate(data.data_reajuste)) || '—' },
    ]),
    kvSection('Observações', [{ label: 'Texto', value: data.observacao?.trim() || '—' }]),
  ];

  if (contatosRows.length) {
    sections.push(
      tableSection('Contatos', ['Nome', 'Tipo', 'Valor', 'Criado em'], contatosRows),
    );
  }
  if (mensRows.length) {
    sections.push(
      tableSection('Mensalidades geradas', ['Competência', 'Vencimento', 'Valor', 'Pago', 'Status'], mensRows),
    );
  }

  return {
    title: `Cliente — ${data.nome_cliente}`,
    subtitle: data.documento,
    sections,
    sheets: [
      sheetFromTable('Cliente', ['Campo', 'Valor'], [
        ['Documento', data.documento],
        ['Nome', data.nome_cliente],
        ['Mensalidade', formatBRL(data.valor_mensalidade)],
        ['Situação', data.cancelado ? 'Cancelado' : 'Ativo'],
      ]),
      ...(contatosRows.length
        ? [sheetFromTable('Contatos', ['Nome', 'Tipo', 'Valor', 'Criado em'], contatosRows)]
        : []),
      ...(mensRows.length
        ? [
            sheetFromTable(
              'Mensalidades',
              ['Competência', 'Vencimento', 'Valor', 'Pago', 'Status'],
              mensRows,
            ),
          ]
        : []),
    ],
  };
}

export function buildClientFormExport(values: ClienteFormValues, title: string): ExportReportPayload {
  const items = [
    { label: 'Documento', value: values.documento || '—' },
    { label: 'CNPJ', value: values.cnpj || '—' },
    { label: 'Inscrição estadual', value: values.inscricao_estadual || '—' },
    { label: 'Nome', value: values.nome_cliente },
    { label: 'Empresa', value: values.nome_empresa || '—' },
    { label: 'Segmento', value: values.segmento_cliente_codigo },
    { label: 'Mensalidade', value: values.valor_mensalidade },
    { label: 'Cancelado', value: values.cancelado ? 'Sim' : 'Não' },
    {
      label: 'Justificativa cancelamento',
      value: values.cancelamento_justificativa || '—',
    },
    { label: 'CEP', value: values.cep },
    { label: 'Cidade', value: `${values.cidade} / ${values.uf}` },
    { label: 'Observação', value: values.observacao || '—' },
  ];
  return {
    title,
    sections: [kvSection('Dados do formulário', items)],
    sheets: [sheetFromTable('Formulario', ['Campo', 'Valor'], items.map((i) => [i.label, i.value]))],
  };
}

export function buildVendasListExport(
  rows: VendaListRow[],
  stats: VendaFinanceiroStats | null,
  filterSummary: string,
): ExportReportPayload {
  const columns = ['Cliente', 'Descrição', 'Total', 'Pago', 'Pendente', 'Status', 'Parcelas', 'Criada em'];
  const tableRows = rows.map((v) => [
    v.cliente?.nome_cliente ?? '—',
    vendaDescricaoResumo(v),
    formatBRL(v.valor_total),
    formatBRL(v.valor_pago_sum ?? 0),
    formatBRL(v.valor_pendente ?? 0),
    v.status,
    String(v.qtd_parcelas ?? 0),
    formatDateTimeBRFromISO(v.created_at) || '',
  ]);

  return {
    title: 'Vendas',
    subtitle: filterSummary,
    sections: [
      kvSection('Resumo financeiro', [
        { label: 'Total vendido', value: formatBRL(stats?.totalVendido ?? 0) },
        { label: 'Total recebido', value: formatBRL(stats?.totalRecebido ?? 0) },
        { label: 'Total pendente', value: formatBRL(stats?.totalPendente ?? 0) },
        { label: 'Parcelas atrasadas', value: String(stats?.parcelasAtrasadas ?? 0) },
        { label: 'Vendas em aberto', value: String(stats?.vendasAbertas ?? 0) },
        { label: 'Registros na lista', value: String(rows.length) },
      ]),
      tableSection('Vendas', columns, tableRows),
    ],
    sheets: [sheetFromTable('Vendas', columns, tableRows)],
  };
}

export function buildVendaDetailExport(detail: VendaDetail): ExportReportPayload {
  const parcRows = detail.parcelas.map((p) => [
    String(p.numero_parcela),
    p.data_vencimento.split('-').reverse().join('/'),
    formatBRL(p.valor),
    formatBRL(p.valor_pago),
    parcelaStatusVisual(p),
    p.forma_pagamento?.nome ?? '—',
  ]);

  const payRows = detail.pagamentos.map((pay) => [
    pay.data_pagamento.split('-').reverse().join('/'),
    formatBRL(pay.valor_pago),
    pay.observacao ?? '—',
    formatDateTimeBRFromISO(pay.created_at) || '',
  ]);

  return {
    title: `Venda — ${detail.cliente.nome_cliente}`,
    subtitle: vendaDescricaoResumo(detail),
    sections: [
      kvSection('Venda', [
        { label: 'Cliente', value: detail.cliente.nome_cliente },
        { label: 'Empresa', value: detail.cliente.nome_empresa ?? '—' },
        { label: 'Descrição', value: vendaDescricaoResumo(detail) },
        { label: 'Valor total', value: formatBRL(detail.valor_total) },
        { label: 'Status', value: detail.status },
        { label: 'Criada em', value: formatDateTimeBRFromISO(detail.created_at) || '—' },
      ]),
      tableSection('Parcelas', ['Nº', 'Vencimento', 'Valor', 'Pago', 'Status', 'Forma pag.'], parcRows),
      ...(payRows.length
        ? [tableSection('Pagamentos', ['Data', 'Valor', 'Obs.', 'Registrado em'], payRows)]
        : []),
    ],
    sheets: [
      sheetFromTable('Venda', ['Campo', 'Valor'], [
        ['Cliente', detail.cliente.nome_cliente],
        ['Total', formatBRL(detail.valor_total)],
        ['Status', detail.status],
      ]),
      sheetFromTable('Parcelas', ['Nº', 'Vencimento', 'Valor', 'Pago', 'Status', 'Forma'], parcRows),
      ...(payRows.length
        ? [sheetFromTable('Pagamentos', ['Data', 'Valor', 'Obs.', 'Registrado'], payRows)]
        : []),
    ],
  };
}

export function buildMensalidadesExport(
  rows: MensalidadeGerada[],
  clienteFiltro?: string,
): ExportReportPayload {
  const columns = ['Cliente', 'Empresa', 'Competência', 'Vencimento', 'Valor', 'Pago', 'Status'];
  const tableRows = rows.map((m) => {
    const c = Array.isArray(m.clientes) ? m.clientes[0] : m.clientes;
    return [
      c?.nome_cliente ?? '—',
      c?.nome_empresa ?? '—',
      m.competencia ?? '—',
      m.data_vencimento.split('-').reverse().join('/'),
      formatBRL(m.valor),
      formatBRL(m.valor_pago),
      mensalidadeGeradaStatusVisual(m),
    ];
  });

  return {
    title: 'Mensalidades geradas',
    subtitle: clienteFiltro ? 'Filtrado por cliente' : 'Histórico completo',
    sections: [
      kvSection('Resumo', [{ label: 'Total de registros', value: String(rows.length) }]),
      tableSection('Mensalidades', columns, tableRows),
    ],
    sheets: [sheetFromTable('Mensalidades', columns, tableRows)],
  };
}

export function buildGerarMensalidadeExport(
  clientes: ClienteListItem[],
  opts: {
    competencia: string;
    vencimento: string;
    segmento: string;
    incluirCancelados: boolean;
    mesReajuste: string;
  },
): ExportReportPayload {
  const columns = [
    'Cliente',
    'Empresa',
    'Documento',
    'Segmento',
    'Mensalidade',
    'Data reajuste',
    'Situação',
  ];
  const rows = clientes.map((c) => [
    c.nome_cliente,
    c.nome_empresa ?? '',
    c.documento,
    c.segmento_cliente?.nome ?? c.segmento_cliente_codigo ?? '',
    formatBRL(c.valor_mensalidade),
    c.data_reajuste ? c.data_reajuste.split('-').reverse().join('/') : '—',
    c.cancelado ? 'Cancelado' : 'Ativo',
  ]);

  return {
    title: 'Gerar mensalidade — prévia',
    subtitle: `Competência: ${opts.competencia || '—'} · Vencimento: ${opts.vencimento}`,
    sections: [
      kvSection('Parâmetros', [
        { label: 'Competência', value: opts.competencia || '—' },
        { label: 'Vencimento', value: opts.vencimento },
        { label: 'Segmento filtro', value: opts.segmento },
        { label: 'Incluir cancelados', value: opts.incluirCancelados ? 'Sim' : 'Não' },
        { label: 'Filtro reajuste (mês)', value: opts.mesReajuste || '—' },
        { label: 'Clientes na lista', value: String(clientes.length) },
      ]),
      tableSection('Clientes elegíveis', columns, rows),
    ],
    sheets: [sheetFromTable('Clientes', columns, rows)],
  };
}

export function buildContasReceberExport(rows: ContaReceberListRow[]): ExportReportPayload {
  const columns = [
    'Cliente',
    'Origem',
    'Situação',
    'Referência',
    'Valor',
    'Vencimento',
    'Nº documento',
  ];
  const tableRows = rows.map((r) => [
    r.nome_cliente,
    r.origem === 'mensalidade' ? 'Mensalidade' : 'Venda',
    labelSituacaoCobranca(r.situacao_cobranca),
    r.referencia_label,
    formatBRL(r.valor_documento),
    r.data_vencimento.split('-').reverse().join('/'),
    r.numero_documento,
  ]);

  return {
    title: 'Contas a receber',
    subtitle: 'Boletos/carnês informativos por parcela ou mensalidade',
    sections: [
      kvSection('Resumo', [
        { label: 'Total de boletos', value: String(rows.length) },
        {
          label: 'Vendas',
          value: String(rows.filter((r) => r.origem === 'venda').length),
        },
        {
          label: 'Mensalidades',
          value: String(rows.filter((r) => r.origem === 'mensalidade').length),
        },
        {
          label: 'Em aberto',
          value: String(rows.filter((r) => r.situacao_cobranca === 'aberto').length),
        },
        {
          label: 'Pagos',
          value: String(rows.filter((r) => r.situacao_cobranca === 'pago').length),
        },
      ]),
      tableSection('Boletos', columns, tableRows),
    ],
    sheets: [sheetFromTable('ContasReceber', columns, tableRows)],
  };
}

export function buildSegmentosExport(rows: SegmentoClienteRow[]): ExportReportPayload {
  const columns = ['Código', 'Nome', 'Ordem'];
  const tableRows = rows.map((s) => [s.codigo, s.nome, String(s.ordem ?? '')]);
  return {
    title: 'Segmentos de cliente',
    sections: [tableSection('Segmentos', columns, tableRows)],
    sheets: [sheetFromTable('Segmentos', columns, tableRows)],
  };
}

export function buildPerfilCobrancaExport(values: PerfilCobrancaInput): ExportReportPayload {
  const items = Object.entries({
    'Razão social': values.razao_social,
    Documento: values.documento,
    Logradouro: values.logradouro,
    Número: values.numero,
    Bairro: values.bairro,
    Cidade: values.cidade,
    UF: values.uf,
    CEP: values.cep,
    Cooperativa: values.cooperativa_nome ?? '—',
    'Cód. beneficiário': values.codigo_beneficiario_agencia ?? '—',
    Telefone: values.telefone_suporte ?? '—',
    'Local pagamento': values.local_pagamento,
    Instruções: values.instrucoes_cobranca,
    'Mensagem pagador': values.mensagem_padrao_pagador ?? '—',
  }).map(([label, value]) => ({ label, value: String(value) }));

  return {
    title: 'Dados do beneficiário (boleto)',
    sections: [kvSection('Perfil de cobrança', items)],
    sheets: [
      sheetFromTable('Beneficiario', ['Campo', 'Valor'], items.map((i) => [i.label, i.value])),
    ],
  };
}

export function buildConfiguracoesExport(): ExportReportPayload {
  const items = [
    { label: 'Segmentos de cliente', value: 'Cadastro de códigos e nomes de segmento' },
    { label: 'Dados do beneficiário', value: 'Razão social, endereço e instruções dos boletos' },
  ];
  return {
    title: 'Configurações',
    sections: [kvSection('Opções disponíveis', items)],
    sheets: [sheetFromTable('Config', ['Opção', 'Descrição'], items.map((i) => [i.label, i.value]))],
  };
}

export function buildNovaVendaExport(opts: {
  cliente: string;
  descricao: string;
  valorTotal: string;
  parcelas: { numero: number; vencimento: string; valor: string; forma: string }[];
}): ExportReportPayload {
  const parcRows = opts.parcelas.map((p) => [
    String(p.numero),
    p.vencimento,
    p.valor,
    p.forma,
  ]);
  return {
    title: 'Nova venda — prévia',
    subtitle: opts.cliente,
    sections: [
      kvSection('Dados', [
        { label: 'Cliente', value: opts.cliente },
        { label: 'Descrição', value: opts.descricao || '—' },
        { label: 'Valor total', value: opts.valorTotal },
        { label: 'Parcelas', value: String(opts.parcelas.length) },
      ]),
      ...(parcRows.length
        ? [tableSection('Parcelas', ['Nº', 'Vencimento', 'Valor', 'Forma pagamento'], parcRows)]
        : []),
    ],
    sheets: [
      sheetFromTable('Venda', ['Campo', 'Valor'], [
        ['Cliente', opts.cliente],
        ['Descrição', opts.descricao],
        ['Total', opts.valorTotal],
      ]),
      ...(parcRows.length
        ? [sheetFromTable('Parcelas', ['Nº', 'Vencimento', 'Valor', 'Forma'], parcRows)]
        : []),
    ],
  };
}

export function buildAccountExport(email: string): ExportReportPayload {
  const items = [
    { label: 'E-mail', value: email },
    { label: 'Módulos', value: 'Clientes, Mensalidades, Vendas, Contas a receber, Configurações' },
  ];
  return {
    title: 'Minha conta',
    sections: [kvSection('Conta', items)],
    sheets: [sheetFromTable('Conta', ['Campo', 'Valor'], items.map((i) => [i.label, i.value]))],
  };
}
