import type { ClienteFormValues } from '@/types/models';
import { formatBRL } from '@/utils/currency';
import { parseISODate, toISODate } from '@/utils/date';
import * as XLSX from 'xlsx';

export type ParsedImportClienteRow = {
  /** Número da linha na planilha (1 = primeira linha do arquivo). */
  lineNumber: number;
  values: ClienteFormValues;
};

export type ParseRecFixoResult =
  | { ok: true; rows: ParsedImportClienteRow[]; skipped: { lineNumber: number; reason: string }[] }
  | { ok: false; error: string };

function normalizeHeader(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

type ColKey =
  | 'empresa'
  | 'cliente'
  | 'tipoRecebimento'
  | 'id'
  | 'valor'
  | 'condicaoPgt'
  | 'contaCorrente'
  | 'tipoComercializacao'
  | 'tipoMovReceber'
  | 'vendedor'
  | 'dataInclusao'
  | 'usuarioInclusao';

function headerToColKey(norm: string): ColKey | null {
  if (norm === 'empresa') return 'empresa';
  if (norm === 'cliente') return 'cliente';
  if (norm.includes('tipo recebimento')) return 'tipoRecebimento';
  if (norm === 'id' || norm === 'codigo' || norm === 'cod') return 'id';
  if (norm === 'valor' || norm.includes('valor mensal')) return 'valor';
  if (norm.includes('condicao') && norm.includes('pgt')) return 'condicaoPgt';
  if (norm.includes('conta corrente') || norm === 'banco') return 'contaCorrente';
  if (norm.includes('tipo comercializacao')) return 'tipoComercializacao';
  if (norm.includes('tipo mov') && norm.includes('receber')) return 'tipoMovReceber';
  if (norm.includes('vendedor')) return 'vendedor';
  if (norm.includes('data inclusao') || norm.includes('data cadastro')) return 'dataInclusao';
  if (norm.includes('usuario inclusao') || norm.includes('usuario cadastro')) return 'usuarioInclusao';
  return null;
}

function cellToString(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return toISODate(new Date(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  if (typeof v === 'boolean') return v ? 'sim' : 'nao';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    if (Math.abs(v) > 1e12) return String(v);
    return String(v);
  }
  return String(v).trim();
}

function toPositiveAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const only = raw.replace(/[^\d,.-]/g, '');
  if (/^\d+,\d{2}$/.test(only)) {
    const n = Number(only.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = Number(only.replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

function extractDiaMes(...texts: string[]): string {
  for (const t of texts) {
    const m = t.match(/dia\s*(\d{1,2})\b/i);
    if (m) return m[1];
  }
  return '';
}

function parseDataInclusaoCell(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  const s = cellToString(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return parseISODate(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (br) {
    const d = Number(br[1]);
    const mo = Number(br[2]);
    const y = Number(br[3]);
    if (y && mo && d) return new Date(y, mo - 1, d);
  }
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    const utc = (v - 25569) * 86400 * 1000;
    const dt = new Date(utc);
    if (!Number.isNaN(dt.getTime())) {
      return new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    }
  }
  return null;
}

function buildObservacao(o: Partial<Record<ColKey, string>>): string {
  const lines: string[] = [];
  if (o.tipoRecebimento) lines.push(`Tipo recebimento: ${o.tipoRecebimento}`);
  if (o.condicaoPgt) lines.push(`Condição pagamento: ${o.condicaoPgt}`);
  if (o.contaCorrente) lines.push(`Conta corrente: ${o.contaCorrente}`);
  if (o.tipoMovReceber) lines.push(`Tipo mov. receber: ${o.tipoMovReceber}`);
  if (o.id) lines.push(`ID (planilha): ${o.id}`);
  if (o.vendedor) lines.push(`Vendedor: ${o.vendedor}`);
  if (o.usuarioInclusao) lines.push(`Usuário inclusão: ${o.usuarioInclusao}`);
  return lines.join('\n').trim();
}

function inferSegmentoCodigoFromPlanilha(...parts: string[]): string {
  const raw = parts.join(' ').trim();
  const t = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!t) return 'DIVERSOS';
  if (/\bmei\b|micro\s*empreendedor/.test(t)) return 'MEI';
  if (/pj|juridica?|cnpj|ltda|s\.\s*a\.|eireli|epp|ltda\.?\s*me/.test(t)) return 'PJ';
  if (/associ|cooperativa/.test(t)) return 'ASSOCIACAO';
  if (/pf|fisica?|cpf/.test(t) && !/juridica/.test(t)) return 'PF';
  return 'DIVERSOS';
}

function emptyImportForm(): ClienteFormValues {
  return {
    cnpj: '',
    inscricao_estadual: '',
    documento: '',
    nome_cliente: '',
    nome_empresa: '',
    mes_entrada: '',
    valor_mensalidade_anterior: '',
    valor_mensalidade: '',
    segmento_cliente_codigo: 'DIVERSOS',
    data_inicio: null,
    data_reajuste: null,
    ultimo_reajuste: null,
    observacao: '',
    contatos: [],
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    pdfPath: null,
    pdfLocalUri: null,
    pdfFileName: null,
    cancelado: false,
    cancelamento_justificativa: '',
    emite_nf: false,
  };
}

function rowToValues(
  cells: unknown[],
  headerKeys: (ColKey | null)[],
):
  | { kind: 'ok'; values: ClienteFormValues }
  | { kind: 'skip' }
  | { kind: 'error'; message: string } {
  const o: Partial<Record<ColKey, string>> = {};
  let valorRaw: unknown;
  let dataRaw: unknown;

  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i];
    if (!key) continue;
    const raw = cells[i];
    if (key === 'valor') {
      valorRaw = raw;
      o.valor = typeof raw === 'number' ? String(raw) : cellToString(raw);
      continue;
    }
    if (key === 'dataInclusao') {
      dataRaw = raw;
      const d = parseDataInclusaoCell(raw);
      o[key] = d ? toISODate(d) : '';
      continue;
    }
    o[key] = cellToString(raw);
  }

  const nome_cliente = (o.cliente ?? '').trim();
  if (!nome_cliente) return { kind: 'skip' };

  const valorNum = toPositiveAmount(valorRaw);
  if (valorNum == null || valorNum <= 0) {
    return { kind: 'error', message: 'Valor inválido ou vazio.' };
  }

  const segText = `${o.tipoComercializacao ?? ''} ${o.tipoMovReceber ?? ''}`.trim();
  const segmento_cliente_codigo = inferSegmentoCodigoFromPlanilha(segText);

  const mes_entrada = extractDiaMes(o.tipoRecebimento ?? '', o.condicaoPgt ?? '');

  const values = emptyImportForm();
  values.nome_cliente = nome_cliente;
  values.nome_empresa = (o.empresa ?? '').trim();
  values.valor_mensalidade = formatBRL(valorNum);
  values.segmento_cliente_codigo = segmento_cliente_codigo;
  values.mes_entrada = mes_entrada;
  values.data_inicio = parseDataInclusaoCell(dataRaw);
  values.observacao = buildObservacao(o).slice(0, 8000);

  return { kind: 'ok', values };
}

function matrixFromSheet(ws: XLSX.WorkSheet): unknown[][] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows: unknown[][] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const row: unknown[] = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      row.push(cell?.v !== undefined ? cell.v : '');
    }
    rows.push(row);
  }
  return rows;
}

export function parseRecFixoSpreadsheet(buf: ArrayBuffer): ParseRecFixoResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: true });
  } catch {
    return { ok: false, error: 'Não foi possível ler o arquivo. Use .xls, .xlsx ou .csv.' };
  }
  const name = wb.SheetNames[0];
  if (!name) return { ok: false, error: 'A planilha está vazia.' };
  const ws = wb.Sheets[name];
  if (!ws) return { ok: false, error: 'Planilha inválida.' };

  const rows = matrixFromSheet(ws);
  let headerIdx = -1;
  let headerKeys: (ColKey | null)[] = [];

  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] ?? [];
    const keys = r.map((c) => headerToColKey(normalizeHeader(c)));
    const hasCliente = keys.includes('cliente');
    const hasValor = keys.includes('valor');
    if (hasCliente && hasValor) {
      headerIdx = i;
      headerKeys = keys;
      break;
    }
  }

  if (headerIdx < 0) {
    return {
      ok: false,
      error:
        'Cabeçalho não reconhecido. A planilha deve ter colunas "Cliente" e "Valor" (como em Rec. fixo sistema).',
    };
  }

  const out: ParsedImportClienteRow[] = [];
  const skipped: { lineNumber: number; reason: string }[] = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const lineNumber = r + 1;
    const cells = rows[r] ?? [];
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;

    const res = rowToValues(cells, headerKeys);
    if (res.kind === 'error') {
      const hint = String(cells[headerKeys.indexOf('cliente')] ?? '').trim().slice(0, 40);
      skipped.push({
        lineNumber,
        reason: `${res.message}${hint ? ` (${hint})` : ''}`,
      });
      continue;
    }
    if (res.kind === 'skip') continue;
    out.push({ lineNumber, values: res.values });
  }

  return { ok: true, rows: out, skipped };
}
