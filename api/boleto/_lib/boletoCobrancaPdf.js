/**
 * PDF de cobrança com multa/juros atualizados (boleto atrasado).
 * O PDF oficial do banco mantém valor de face; este espelha o carnê do app.
 */
const { jsPDF } = require('jspdf');
const { calcularEncargosBoleto } = require('./boletoEncargos');

function safeTrim(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function formatBRL(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatBRDate(iso) {
  const s = safeTrim(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s || '—';
}

function buildBoletoCobrancaPdfBuffer(boleto) {
  const row = boleto || {};
  const quitado = row.status_registro === 'pago' || row.status_registro === 'baixado';
  const encargos = quitado ? null : calcularEncargosBoleto(row.valor_documento, row.data_vencimento);
  const banco =
    row.tipo_emissao === 'c6' ? 'C6 Bank' : row.tipo_emissao === 'sicoob' ? 'Sicoob' : 'Cobrança';
  const registrado = row.status_registro === 'registrado' || row.status_registro === 'pago';
  const nosso =
    registrado && row.nosso_numero_banco ? row.nosso_numero_banco : row.nosso_numero || '—';
  const valorFace = formatBRL(row.valor_documento);
  const mora = encargos?.vencido ? encargos.multa + encargos.juros : 0;
  const valorCobrado = encargos?.vencido ? encargos.total : Number(row.valor_documento) || 0;

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const margin = 12;
  const pageW = pdf.internal.pageSize.getWidth();
  const maxW = pageW - margin * 2;
  let y = margin;

  const line = (txt, opts = {}) => {
    const size = opts.size || 9;
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(txt ?? ''), opts.width || maxW);
    pdf.text(lines, opts.x ?? margin, y);
    y += lines.length * (size * 0.42) + (opts.gap ?? 2);
  };

  const box = (label, value, opts = {}) => {
    const h = opts.h || 10;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.25);
    pdf.rect(margin, y, maxW, h);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.text(String(label).toUpperCase(), margin + 2, y + 3.2);
    pdf.setFont('helvetica', opts.boldValue === false ? 'normal' : 'bold');
    pdf.setFontSize(opts.size || 10);
    const lines = pdf.splitTextToSize(String(value ?? '—'), maxW - 4);
    pdf.text(lines, margin + 2, y + 7);
    y += h + 1.2;
  };

  line(
    registrado
      ? `Boleto registrado no ${banco} — linha digitável abaixo. Valores de mora atualizados para hoje.`
      : `Documento de cobrança (${banco}) — valores de mora atualizados para hoje.`,
    { size: 8, gap: 3 },
  );

  if (safeTrim(row.linha_digitavel)) {
    box('Linha digitável', safeTrim(row.linha_digitavel), { h: 12, size: 9 });
  }

  line(`Beneficiário: ${safeTrim(row.beneficiario_razao_social) || '—'}`, { bold: true, gap: 1 });
  line(`CNPJ/CPF: ${safeTrim(row.beneficiario_documento) || '—'}`, { size: 8, gap: 2 });

  box('Vencimento', formatBRDate(row.data_vencimento), { h: 9 });
  box('Valor do documento', valorFace, { h: 9 });
  box('(-) Desconto / Abatimento', formatBRL(0), { h: 8, boldValue: false });
  box('(+) Mora / Multa', formatBRL(mora), { h: encargos?.vencido ? 14 : 8 });
  if (encargos?.vencido) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(60, 60, 60);
    pdf.text(
      `Multa 2%: ${formatBRL(encargos.multa)}  ·  Juros 0,033%/dia × ${encargos.dias} dia(s): ${formatBRL(encargos.juros)}`,
      margin + 2,
      y - 4.2,
    );
    pdf.setTextColor(0, 0, 0);
  }
  box('(=) Valor cobrado (hoje)', formatBRL(valorCobrado), { h: 10, size: 12 });

  box('Pagador', safeTrim(row.pagador_nome) || '—', { h: 9 });
  box('Documento do pagador', safeTrim(row.pagador_documento) || '—', { h: 8, boldValue: false });
  box('Endereço', safeTrim(row.pagador_endereco) || '—', { h: 10, boldValue: false });
  box('Município / UF / CEP', safeTrim(row.pagador_cidade_uf_cep) || '—', { h: 8, boldValue: false });
  box('Nº documento', safeTrim(row.numero_documento) || '—', { h: 8 });
  box('Nosso número', String(nosso), { h: 8 });

  if (safeTrim(row.instrucoes)) {
    box('Instruções', safeTrim(row.instrucoes).slice(0, 900), { h: 22, boldValue: false, size: 8 });
  }

  y += 2;
  line(
    'Este PDF atualiza multa/juros para a data de emissão do arquivo. O boleto oficial do banco mantém o valor de face; na liquidação o banco aplica os encargos cadastrados no título.',
    { size: 7, gap: 1 },
  );

  return Buffer.from(pdf.output('arraybuffer'));
}

module.exports = { buildBoletoCobrancaPdfBuffer };
