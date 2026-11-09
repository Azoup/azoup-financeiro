/**
 * Artefatos pós-autorização ABRASF: XML limpo + DANFSe HTML
 * no layout oficial “Nota da Cidade” — Município de Americana/SP.
 */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function moneyBr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0,00';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCpfCnpj(raw) {
  const d = onlyDigits(raw);
  if (d.length === 14) {
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (d.length === 11) {
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return String(raw ?? '').trim() || '—';
}

function formatCep(raw) {
  const d = onlyDigits(raw);
  if (d.length === 8) return d.replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return String(raw ?? '').trim() || '';
}

function formatDataHoraBr(iso) {
  const raw = String(iso ?? '').trim();
  if (!raw) return '—';
  // Já no formato dd/mm/yyyy ...
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) return raw;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]?(\d{2})?:?(\d{2})?/);
  if (m) {
    const h = m[4] != null ? `${m[4]}:${m[5] || '00'}` : '';
    return h ? `${Number(m[3])}/${Number(m[2])}/${m[1]} ${h}` : `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
  }
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('pt-BR', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } catch {
    /* ignore */
  }
  return raw;
}

function formatEndereco({ logradouro, numero, bairro, cep }) {
  const parts = [];
  const rua = [logradouro, numero]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (rua) parts.push(rua);
  const bairroStr = String(bairro ?? '').trim();
  if (bairroStr) parts.push(bairroStr);
  const cepF = formatCep(cep);
  if (cepF) parts.push(`Cep: ${cepF}`);
  return parts.join(' - ') || '—';
}

/** Extrai CompNfse / Nfse do retorno SOAP TipLan. */
function extrairXmlNfse(xmlRaw) {
  const raw = String(xmlRaw ?? '');
  if (!raw.trim()) return null;
  const comp = raw.match(/<CompNfse[\s\S]*?<\/CompNfse>/i);
  if (comp) return `<?xml version="1.0" encoding="UTF-8"?>\n${comp[0]}`;
  const nfse = raw.match(/<Nfse[\s\S]*?<\/Nfse>/i);
  if (nfse) return `<?xml version="1.0" encoding="UTF-8"?>\n${nfse[0]}`;
  if (/InfNfse|CodigoVerificacao/i.test(raw)) return raw;
  return raw;
}

function tagXml(xml, name) {
  const m = String(xml ?? '').match(new RegExp(`<${name}[^>]*>\\s*([^<]*)\\s*</${name}>`, 'i'));
  return m?.[1]?.trim() || '';
}

/**
 * Enriquece meta com dados do XML autorizado (quando disponíveis).
 */
function enriquecerMetaDoXml(meta, xmlRaw) {
  const xml = String(xmlRaw ?? '');
  if (!xml) return meta;
  const numero = tagXml(xml, 'Numero') || meta.numero;
  // Preferir InfNfse/Numero (primeiro Numero após InfNfse)
  const nInf = xml.match(/<InfNfse[\s\S]*?<Numero>\s*([^<]+)\s*<\/Numero>/i)?.[1]?.trim();
  const codVerif = tagXml(xml, 'CodigoVerificacao') || meta.codigoVerificacao;
  const dataEmissao =
    tagXml(xml, 'DataEmissao') ||
    xml.match(/<DataEmissao>\s*([^<]+)\s*<\/DataEmissao>/i)?.[1]?.trim() ||
    meta.dataEmissao;
  const discriminacao = tagXml(xml, 'Discriminacao') || meta.discriminacao;
  const itemLista = tagXml(xml, 'ItemListaServico') || meta.itemLista;
  const valorServicos =
    tagXml(xml, 'ValorServicos') ||
    xml.match(/<ValorServicos>\s*([^<]+)\s*<\/ValorServicos>/i)?.[1]?.trim();
  const optanteXml =
    tagXml(xml, 'OptanteSimplesNacional') ||
    xml.match(/<OptanteSimplesNacional>\s*([^<]+)\s*<\/OptanteSimplesNacional>/i)?.[1]?.trim();
  return {
    ...meta,
    numero: nInf || numero || meta.numero,
    codigoVerificacao: codVerif,
    dataEmissao,
    discriminacao,
    itemLista,
    valor: valorServicos ? Number(valorServicos) : meta.valor,
    // ABRASF: 1 = optante Simples, 2 = não optante
    optanteSimplesNacional: optanteXml || meta.optanteSimplesNacional,
  };
}

/** Textos de "Outras informações" conforme regime / OptanteSimplesNacional do XML. */
function linhasOutrasInformacoesRegime(m) {
  const optante = String(m.optanteSimplesNacional ?? '').trim();
  const regime = Number(m.regimeTributario ?? 0);
  const opSimp = Number(m.opSimpNac ?? 0);
  // Prioriza XML autorizado; senão CRT/op_simp do emitente
  const isSimples =
    optante === '1' ||
    (!optante && (regime === 1 || regime === 2 || opSimp === 2 || opSimp === 3 || opSimp === 4));

  if (isSimples) {
    return [
      'O ISS desta NFS-e deverá ser recolhido através do Documento de Arrecadação do Simples Nacional.',
      '(*) Documento emitido por ME ou EPP optante pelo SIMPLES NACIONAL.',
      'Esta NFS-e não gera crédito.',
    ];
  }
  return [
    'Documento emitido por contribuinte do Regime Normal (não optante pelo Simples Nacional).',
    'O ISS, quando devido, deve ser recolhido conforme legislação municipal aplicável.',
    'Esta NFS-e não gera crédito de ISS ao tomador por esta via.',
  ];
}

const DESCRICAO_ITEM_LISTA = {
  '01.07':
    '01.07 - Suporte técnico em informática, inclusive instalação, configuração e manutenção de programas de computação e de bancos de dados.',
  '01.01': '01.01 - Análise e desenvolvimento de sistemas.',
  '01.02': '01.02 - Programação.',
  '01.03': '01.03 - Processamento, armazenamento ou hospedagem de dados, textos, imagens, vídeos, páginas eletrônicas, aplicativos e sistemas de informação, entre outros formatos, e congêneres.',
  '01.04': '01.04 - Elaboração de programas de computadores, inclusive de jogos eletrônicos, independentemente da arquitetura construtiva da máquina em que o programa será executado, incluindo tablets, smartphones e congêneres.',
  '01.05': '01.05 - Licenciamento ou cessão de direito de uso de programas de computação.',
  '01.06': '01.06 - Assessoria e consultoria em informática.',
};

function descricaoItemLista(codigo) {
  const c = String(codigo ?? '').trim();
  if (DESCRICAO_ITEM_LISTA[c]) return DESCRICAO_ITEM_LISTA[c];
  return c ? `${c} - Serviço municipal` : '—';
}

/**
 * Layout tipográfico alinhado à NFS-e impressa do portal Americana (Nota da Cidade).
 */
function buildDanfseHtml(metaIn) {
  const m = metaIn || {};
  const numero = m.numero || '—';
  const dataHora = formatDataHoraBr(m.dataEmissao);
  const codVerif = m.codigoVerificacao || '—';
  const valor = moneyBr(m.valor);
  const disc = m.discriminacao || 'Prestação de serviços';
  const itemCod = m.itemLista || '01.07';
  const itemDesc = m.itemListaDescricao || descricaoItemLista(itemCod);
  const rpsNum = m.rpsNumero || '';
  const rpsSerie = m.rpsSerie || m.serie || '1';
  const rpsData = m.rpsDataEmissao ? formatDataHoraBr(m.rpsDataEmissao) : dataHora;

  const prestEnd = m.prestadorEndereco || formatEndereco(m.prestador || {});
  const tomEnd = m.tomadorEndereco || formatEndereco(m.tomador || {});

  const outras = [
    'Esta NFS-e foi emitida com respaldo da Lei nº 4.930/2009 e no Decreto nº 8.250/2009.',
    ...linhasOutrasInformacoesRegime(m),
  ];
  if (rpsNum) {
    outras.push(
      `Esta NFS-e substitui o RPS Nº ${rpsNum} Série ${rpsSerie}, emitido em ${rpsData}.`,
    );
  }
  if (m.outrasInformacoes) {
    outras.push(String(m.outrasInformacoes));
  }

  let logoSrc = '';
  try {
    logoSrc = require('../../../utils/azoupLogoDataUri');
  } catch {
    logoSrc = '';
  }
  const logoCell = logoSrc
    ? `<td class="pad2 br" style="width:52px;vertical-align:middle"><img src="${logoSrc}" alt="Azoup" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:50%;object-fit:cover"/></td>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>NFS-e ${escapeHtml(numero)} — Americana</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    margin: 0;
    padding: 8px;
    font-size: 10px;
    line-height: 1.25;
    background: #fff;
  }
  .page { max-width: 190mm; margin: 0 auto; border: 1.5px solid #000; }
  table { width: 100%; border-collapse: collapse; }
  td, th { vertical-align: top; }
  .b { border: 1px solid #000; }
  .bb { border-bottom: 1px solid #000; }
  .br { border-right: 1px solid #000; }
  .pad { padding: 4px 6px; }
  .pad2 { padding: 6px 8px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .tiny { font-size: 8px; }
  .small { font-size: 9px; }
  .lbl { font-size: 8px; color: #222; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; }
  .val { font-size: 11px; font-weight: 700; }
  .header-title { font-size: 13px; font-weight: 800; letter-spacing: 0.04em; }
  .header-sub { font-size: 11px; font-weight: 700; }
  .section {
    background: #e8e8e8;
    font-size: 10px;
    font-weight: 800;
    text-align: center;
    padding: 3px 6px;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    letter-spacing: 0.06em;
  }
  .grid-2 td { width: 50%; }
  .muted { color: #333; font-weight: 400; }
  .total-bar {
    font-size: 13px;
    font-weight: 800;
    text-align: right;
    padding: 8px 10px;
    border-top: 2px solid #000;
  }
  .noprint { margin-top: 12px; text-align: center; }
  button {
    padding: 10px 18px;
    font-size: 14px;
    cursor: pointer;
    background: #1a3a4a;
    color: #fff;
    border: 0;
    border-radius: 4px;
  }
  @media print {
    body { padding: 0; }
    .noprint { display: none !important; }
    .page { border: 1.5px solid #000; }
  }
</style>
</head>
<body>
<div class="page">
  <!-- Cabeçalho -->
  <table>
    <tr>
      ${logoCell}
      <td class="pad2 br" style="width:62%">
        <div class="tiny">SECRETARIA MUNICIPAL DE FAZENDA</div>
        <div class="header-title">NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e</div>
        <div class="header-sub">- NOTA DA CIDADE -</div>
        <div class="bold" style="margin-top:4px">MUNICÍPIO DE AMERICANA</div>
      </td>
      <td class="pad2" style="width:38%">
        <table>
          <tr>
            <td class="lbl">Número da Nota</td>
            <td class="val right">${escapeHtml(numero)}</td>
          </tr>
          <tr>
            <td class="lbl">Data e Hora de Emissão</td>
            <td class="val right">${escapeHtml(dataHora)}</td>
          </tr>
          <tr>
            <td class="lbl">Código de Verificação</td>
            <td class="val right">${escapeHtml(codVerif)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="section">PRESTADOR DE SERVIÇOS</div>
  <table>
    <tr>
      <td class="pad br bb" style="width:34%">
        <div class="lbl">CPF/CNPJ</div>
        <div class="val">${escapeHtml(formatCpfCnpj(m.prestadorDoc))}</div>
      </td>
      <td class="pad br bb" style="width:22%">
        <div class="lbl">Inscrição Municipal</div>
        <div class="val">${escapeHtml(m.prestadorIm || '—')}</div>
      </td>
      <td class="pad bb" style="width:44%">
        <div class="lbl">Inscrição Estadual</div>
        <div class="val">${escapeHtml(m.prestadorIe || '—')}</div>
      </td>
    </tr>
    <tr>
      <td class="pad bb" colspan="3">
        <div class="lbl">Nome/Razão Social</div>
        <div class="val">${escapeHtml(m.prestadorNome || '—')}</div>
      </td>
    </tr>
    <tr>
      <td class="pad br bb" colspan="2">
        <div class="lbl">Nome Fantasia</div>
        <div class="val">${escapeHtml(m.prestadorFantasia || m.prestadorNome || '—')}</div>
      </td>
      <td class="pad bb">
        <div class="lbl">Tel.</div>
        <div class="val">${escapeHtml(m.prestadorTel || '—')}</div>
      </td>
    </tr>
    <tr>
      <td class="pad bb" colspan="3">
        <div class="lbl">Endereço</div>
        <div class="val">${escapeHtml(prestEnd)}</div>
      </td>
    </tr>
    <tr>
      <td class="pad br" style="width:40%">
        <div class="lbl">Município</div>
        <div class="val">${escapeHtml(m.prestadorMunicipio || 'AMERICANA')}</div>
      </td>
      <td class="pad br" style="width:12%">
        <div class="lbl">UF</div>
        <div class="val">${escapeHtml(m.prestadorUf || 'SP')}</div>
      </td>
      <td class="pad">
        <div class="lbl">E-mail</div>
        <div class="val">${escapeHtml(m.prestadorEmail || '—')}</div>
      </td>
    </tr>
  </table>

  <div class="section">TOMADOR DE SERVIÇOS</div>
  <table>
    <tr>
      <td class="pad br bb" style="width:34%">
        <div class="lbl">CPF/CNPJ</div>
        <div class="val">${escapeHtml(formatCpfCnpj(m.tomadorDoc))}</div>
      </td>
      <td class="pad br bb" style="width:22%">
        <div class="lbl">Inscrição Municipal</div>
        <div class="val">${escapeHtml(m.tomadorIm || '—')}</div>
      </td>
      <td class="pad bb" style="width:44%">
        <div class="lbl">Inscrição Estadual</div>
        <div class="val">${escapeHtml(m.tomadorIe || '—')}</div>
      </td>
    </tr>
    <tr>
      <td class="pad bb" colspan="3">
        <div class="lbl">Nome/Razão Social</div>
        <div class="val">${escapeHtml(m.tomadorNome || '—')}</div>
      </td>
    </tr>
    <tr>
      <td class="pad bb" colspan="2">
        <div class="lbl">Endereço</div>
        <div class="val">${escapeHtml(tomEnd)}</div>
      </td>
      <td class="pad bb">
        <div class="lbl">Tel.</div>
        <div class="val">${escapeHtml(m.tomadorTel || '—')}</div>
      </td>
    </tr>
    <tr>
      <td class="pad br" style="width:40%">
        <div class="lbl">Município</div>
        <div class="val">${escapeHtml(m.tomadorMunicipio || '—')}</div>
      </td>
      <td class="pad br" style="width:12%">
        <div class="lbl">UF</div>
        <div class="val">${escapeHtml(m.tomadorUf || '—')}</div>
      </td>
      <td class="pad">
        <div class="lbl">E-mail</div>
        <div class="val">${escapeHtml(m.tomadorEmail || '—')}</div>
      </td>
    </tr>
  </table>

  <div class="section">DISCRIMINAÇÃO DOS SERVIÇOS</div>
  <div class="pad2" style="min-height:48px;white-space:pre-wrap">${escapeHtml(disc)}</div>
  <div class="pad2 right bold" style="border-top:1px solid #000">
    Líquido a Receber R$ ${escapeHtml(valor)}
  </div>

  <table>
    <tr>
      <th class="pad bb br tiny">Documento</th>
      <th class="pad bb br tiny">Parcela</th>
      <th class="pad bb br tiny">Valor</th>
      <th class="pad bb tiny">Vencimento</th>
    </tr>
    <tr>
      <td class="pad br">${escapeHtml(m.documentoCobranca || rpsNum || numero)}</td>
      <td class="pad br center">1</td>
      <td class="pad br">R$ ${escapeHtml(valor)}</td>
      <td class="pad">${escapeHtml(m.vencimento || dataHora.split(' ')[0] || '—')}</td>
    </tr>
  </table>

  <div class="pad2 tiny muted" style="border-top:1px solid #000">
    Valor aproximado dos Tributos — Lei nº 12.741/12 (quando informado pela fonte IBPT).
  </div>

  <div class="section">CÓDIGO DO SERVIÇO</div>
  <div class="pad2 bold">${escapeHtml(itemDesc)}</div>
  <table>
    <tr>
      <th class="pad bb br tiny">Deduções (R$)</th>
      <th class="pad bb br tiny">Desconto Incond. (R$)</th>
      <th class="pad bb br tiny">Base de Cálculo (R$)</th>
      <th class="pad bb br tiny">Alíquota (%)</th>
      <th class="pad bb br tiny">Valor do ISS (R$)</th>
      <th class="pad bb tiny">Crédito p/ IPTU (R$)</th>
    </tr>
    <tr>
      <td class="pad br center">0,00</td>
      <td class="pad br center">0,00</td>
      <td class="pad br center">—</td>
      <td class="pad br center">—</td>
      <td class="pad br center">—</td>
      <td class="pad center">0</td>
    </tr>
  </table>

  <div class="section">OUTRAS INFORMAÇÕES</div>
  <div class="pad2 small">
    ${outras.map((l) => `- ${escapeHtml(l)}`).join('<br/>')}
  </div>

  <div class="total-bar">VALOR TOTAL DA NOTA = R$ ${escapeHtml(valor)}</div>
</div>

<p class="noprint tiny muted" style="max-width:190mm;margin:8px auto;text-align:center">
  Autenticidade: nfse.americana.sp.gov.br › Verifique a Autenticidade
  (CNPJ do prestador, número da NFS-e e código de verificação).
</p>
<p class="noprint"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></p>
</body>
</html>`;
}

/**
 * DANFSe em PDF no layout "Nota da Cidade" (Americana) — mesmo desenho do HTML/foto.
 */
function buildDanfsePdfBuffer(metaIn) {
  const { jsPDF } = require('jspdf');
  const m = metaIn || {};
  const numero = String(m.numero || '—');
  const dataHora = formatDataHoraBr(m.dataEmissao);
  const codVerif = String(m.codigoVerificacao || '—');
  const valor = moneyBr(m.valor);
  const disc = String(m.discriminacao || 'Prestação de serviços');
  const itemCod = m.itemLista || '01.07';
  const itemDesc = m.itemListaDescricao || descricaoItemLista(itemCod);
  const rpsNum = m.rpsNumero || '';
  const rpsSerie = m.rpsSerie || m.serie || '1';
  const rpsData = m.rpsDataEmissao ? formatDataHoraBr(m.rpsDataEmissao) : dataHora;
  const prestEnd = m.prestadorEndereco || formatEndereco(m.prestador || {});
  const tomEnd = m.tomadorEndereco || formatEndereco(m.tomador || {});
  const venc =
    m.vencimento ||
    (dataHora.includes(' ') ? dataHora.split(' ')[0] : dataHora) ||
    '—';

  const outras = [
    'Esta NFS-e foi emitida com respaldo da Lei nº 4.930/2009 e no Decreto nº 8.250/2009.',
    ...linhasOutrasInformacoesRegime(m),
  ];
  if (rpsNum) {
    outras.push(`Esta NFS-e substitui o RPS Nº ${rpsNum} Série ${rpsSerie}, emitido em ${rpsData}.`);
  }
  if (m.outrasInformacoes) outras.push(String(m.outrasInformacoes));

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const outer = 8;
  const x0 = outer;
  const x1 = pageW - outer;
  const w = x1 - x0;
  let y = outer;

  const stroke = () => {
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.25);
  };
  const box = (x, yy, ww, hh, style = 'S') => {
    stroke();
    pdf.rect(x, yy, ww, hh, style);
  };
  const fillGray = (x, yy, ww, hh) => {
    pdf.setFillColor(232, 232, 232);
    stroke();
    pdf.rect(x, yy, ww, hh, 'FD');
  };
  const lbl = (txt, x, yy, maxWidth) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.setTextColor(34, 34, 34);
    const lines = pdf.splitTextToSize(String(txt || '').toUpperCase(), maxWidth);
    pdf.text(lines, x, yy);
    return lines.length * 2.2;
  };
  const val = (txt, x, yy, maxWidth, opts = {}) => {
    pdf.setFont('helvetica', opts.bold === false ? 'normal' : 'bold');
    pdf.setFontSize(opts.size || 9);
    pdf.setTextColor(0, 0, 0);
    const lines = pdf.splitTextToSize(String(txt ?? '—'), maxWidth);
    pdf.text(lines, x, yy);
    return lines.length * ((opts.size || 9) * 0.4 + 0.6);
  };
  const sectionBar = (title) => {
    const h = 6;
    fillGray(x0, y, w, h);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(0, 0, 0);
    pdf.text(String(title), pageW / 2, y + 4.1, { align: 'center' });
    y += h;
  };
  const cellPad = 1.6;
  const fieldCell = (label, value, x, yy, ww, hh) => {
    box(x, yy, ww, hh);
    lbl(label, x + cellPad, yy + 3, ww - cellPad * 2);
    val(value, x + cellPad, yy + 6.2, ww - cellPad * 2, { size: 9 });
  };
  const textHeight = (txt, maxWidth, size = 9) => {
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(txt ?? ''), maxWidth);
    return Math.max(1, lines.length) * (size * 0.4 + 0.6);
  };

  // —— Cabeçalho ——
  const headerH = 22;
  const logoW = 16;
  let logoOk = false;
  try {
    const logoSrc = require('../../../utils/azoupLogoDataUri');
    if (typeof logoSrc === 'string' && logoSrc.startsWith('data:image')) {
      const b64 = logoSrc.replace(/^data:image\/\w+;base64,/, '');
      pdf.addImage(b64, 'PNG', x0 + 1.5, y + 3, 13, 13);
      logoOk = true;
    }
  } catch {
    /* sem logo */
  }
  box(x0, y, logoW, headerH);
  const midW = w * 0.55;
  const rightW = w - logoW - midW;
  box(x0 + logoW, y, midW, headerH);
  box(x0 + logoW + midW, y, rightW, headerH);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.text('SECRETARIA MUNICIPAL DE FAZENDA', x0 + logoW + 2.5, y + 4.5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  const titleLines = pdf.splitTextToSize('NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e', midW - 5);
  pdf.text(titleLines, x0 + logoW + 2.5, y + 8.5);
  pdf.setFontSize(8.5);
  pdf.text('- NOTA DA CIDADE -', x0 + logoW + 2.5, y + 14.5);
  pdf.setFontSize(8);
  pdf.text('MUNICÍPIO DE AMERICANA', x0 + logoW + 2.5, y + 18.5);

  const rx = x0 + logoW + midW;
  const metaRows = [
    ['NÚMERO DA NOTA', numero],
    ['DATA E HORA DE EMISSÃO', dataHora],
    ['CÓDIGO DE VERIFICAÇÃO', codVerif],
  ];
  const rh = headerH / 3;
  metaRows.forEach((row, i) => {
    const yy = y + i * rh;
    if (i > 0) {
      stroke();
      pdf.line(rx, yy, rx + rightW, yy);
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(5.8);
    pdf.text(row[0], rx + 1.5, yy + 2.6);
    pdf.setFontSize(8);
    pdf.text(String(row[1]), rx + rightW - 1.5, yy + 5.4, { align: 'right' });
  });
  y += headerH;

  // —— Prestador ——
  sectionBar('PRESTADOR DE SERVIÇOS');
  const pRow1 = 10;
  const c1 = w * 0.34;
  const c2 = w * 0.22;
  const c3 = w - c1 - c2;
  fieldCell('CPF/CNPJ', formatCpfCnpj(m.prestadorDoc), x0, y, c1, pRow1);
  fieldCell('Inscrição Municipal', m.prestadorIm || '—', x0 + c1, y, c2, pRow1);
  fieldCell('Inscrição Estadual', m.prestadorIe || '—', x0 + c1 + c2, y, c3, pRow1);
  y += pRow1;

  const pNomeH = Math.max(9, 5 + textHeight(m.prestadorNome || '—', w - 4, 9));
  box(x0, y, w, pNomeH);
  lbl('Nome/Razão Social', x0 + cellPad, y + 3, w - 4);
  val(m.prestadorNome || '—', x0 + cellPad, y + 6.2, w - 4);
  y += pNomeH;

  const fantW = w * 0.66;
  const telW = w - fantW;
  const pFantH = Math.max(9, 5 + textHeight(m.prestadorFantasia || m.prestadorNome || '—', fantW - 4, 9));
  fieldCell('Nome Fantasia', m.prestadorFantasia || m.prestadorNome || '—', x0, y, fantW, pFantH);
  fieldCell('Tel.', m.prestadorTel || '—', x0 + fantW, y, telW, pFantH);
  y += pFantH;

  const pEndH = Math.max(9, 5 + textHeight(prestEnd, w - 4, 9));
  box(x0, y, w, pEndH);
  lbl('Endereço', x0 + cellPad, y + 3, w - 4);
  val(prestEnd, x0 + cellPad, y + 6.2, w - 4);
  y += pEndH;

  const munW = w * 0.4;
  const ufW = w * 0.12;
  const emW = w - munW - ufW;
  const pMunH = 10;
  fieldCell('Município', m.prestadorMunicipio || 'AMERICANA', x0, y, munW, pMunH);
  fieldCell('UF', m.prestadorUf || 'SP', x0 + munW, y, ufW, pMunH);
  fieldCell('E-mail', m.prestadorEmail || '—', x0 + munW + ufW, y, emW, pMunH);
  y += pMunH;

  // —— Tomador ——
  sectionBar('TOMADOR DE SERVIÇOS');
  fieldCell('CPF/CNPJ', formatCpfCnpj(m.tomadorDoc), x0, y, c1, pRow1);
  fieldCell('Inscrição Municipal', m.tomadorIm || '—', x0 + c1, y, c2, pRow1);
  fieldCell('Inscrição Estadual', m.tomadorIe || '—', x0 + c1 + c2, y, c3, pRow1);
  y += pRow1;

  const tNomeH = Math.max(9, 5 + textHeight(m.tomadorNome || '—', w - 4, 9));
  box(x0, y, w, tNomeH);
  lbl('Nome/Razão Social', x0 + cellPad, y + 3, w - 4);
  val(m.tomadorNome || '—', x0 + cellPad, y + 6.2, w - 4);
  y += tNomeH;

  const tomEndW = w * 0.72;
  const tomTelW = w - tomEndW;
  const tEndH = Math.max(9, 5 + textHeight(tomEnd, tomEndW - 4, 9));
  box(x0, y, tomEndW, tEndH);
  lbl('Endereço', x0 + cellPad, y + 3, tomEndW - 4);
  val(tomEnd, x0 + cellPad, y + 6.2, tomEndW - 4);
  fieldCell('Tel.', m.tomadorTel || '—', x0 + tomEndW, y, tomTelW, tEndH);
  y += tEndH;

  fieldCell('Município', m.tomadorMunicipio || '—', x0, y, munW, pMunH);
  fieldCell('UF', m.tomadorUf || '—', x0 + munW, y, ufW, pMunH);
  fieldCell('E-mail', m.tomadorEmail || '—', x0 + munW + ufW, y, emW, pMunH);
  y += pMunH;

  // —— Discriminação ——
  sectionBar('DISCRIMINAÇÃO DOS SERVIÇOS');
  const discH = Math.max(14, 6 + textHeight(disc, w - 4, 9));
  box(x0, y, w, discH);
  val(disc, x0 + cellPad, y + 4.5, w - 4, { bold: false, size: 9 });
  y += discH;
  const liqH = 7;
  box(x0, y, w, liqH);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text(`Líquido a Receber R$ ${valor}`, x1 - cellPad, y + 4.6, { align: 'right' });
  y += liqH;

  // Tabela cobrança
  const th = 6;
  const td = 7;
  const cols = [w * 0.28, w * 0.18, w * 0.27, w * 0.27];
  const headers = ['Documento', 'Parcela', 'Valor', 'Vencimento'];
  const values = [
    String(m.documentoCobranca || rpsNum || numero),
    '1',
    `R$ ${valor}`,
    String(venc),
  ];
  let cx = x0;
  headers.forEach((h, i) => {
    box(cx, y, cols[i], th);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.text(h, cx + cols[i] / 2, y + 4, { align: 'center' });
    cx += cols[i];
  });
  y += th;
  cx = x0;
  values.forEach((v, i) => {
    box(cx, y, cols[i], td);
    pdf.setFont('helvetica', i === 1 ? 'bold' : 'normal');
    pdf.setFontSize(8.5);
    pdf.text(v, cx + cols[i] / 2, y + 4.6, { align: 'center' });
    cx += cols[i];
  });
  y += td;

  const tipH = 6;
  box(x0, y, w, tipH);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6);
  pdf.setTextColor(51, 51, 51);
  pdf.text(
    'Valor aproximado dos Tributos — Lei nº 12.741/12 (quando informado pela fonte IBPT).',
    x0 + cellPad,
    y + 3.8,
  );
  pdf.setTextColor(0, 0, 0);
  y += tipH;

  // —— Código do serviço ——
  sectionBar('CÓDIGO DO SERVIÇO');
  const codH = Math.max(8, 4 + textHeight(itemDesc, w - 4, 8.5));
  box(x0, y, w, codH);
  val(itemDesc, x0 + cellPad, y + 4, w - 4, { size: 8.5 });
  y += codH;

  const taxHeaders = [
    'Deduções (R$)',
    'Desconto Incond. (R$)',
    'Base de Cálculo (R$)',
    'Alíquota (%)',
    'Valor do ISS (R$)',
    'Crédito p/ IPTU (R$)',
  ];
  const taxVals = ['0,00', '0,00', '—', '—', '—', '0'];
  const tw = w / 6;
  const taxTh = 7;
  const taxTd = 6.5;
  cx = x0;
  taxHeaders.forEach((h, i) => {
    box(cx, y, tw, taxTh);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(5.5);
    const hl = pdf.splitTextToSize(h, tw - 1.5);
    pdf.text(hl, cx + tw / 2, y + (hl.length > 1 ? 2.4 : 4.2), { align: 'center' });
    cx += tw;
  });
  y += taxTh;
  cx = x0;
  taxVals.forEach((v) => {
    box(cx, y, tw, taxTd);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(v, cx + tw / 2, y + 4.2, { align: 'center' });
    cx += tw;
  });
  y += taxTd;

  // —— Outras informações ——
  sectionBar('OUTRAS INFORMAÇÕES');
  const outrasTxt = outras.map((l) => `- ${l}`).join('\n');
  const outH = Math.max(16, 5 + textHeight(outrasTxt, w - 4, 7.5));
  box(x0, y, w, outH);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(pdf.splitTextToSize(outrasTxt, w - 4), x0 + cellPad, y + 4);
  y += outH;

  const totH = 8;
  box(x0, y, w, totH);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(`VALOR TOTAL DA NOTA = R$ ${valor}`, x1 - cellPad, y + 5.3, { align: 'right' });
  y += totH;

  // Moldura externa envolvendo todo o conteúdo
  stroke();
  pdf.setLineWidth(0.55);
  pdf.rect(x0, outer, w, y - outer);

  y += 4;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(80, 80, 80);
  const auth =
    'Autenticidade: nfse.americana.sp.gov.br › Verifique a Autenticidade (CNPJ do prestador, número da NFS-e e código de verificação).';
  pdf.text(pdf.splitTextToSize(auth, w), pageW / 2, y, { align: 'center' });

  void logoOk;
  void pageH;

  return Buffer.from(pdf.output('arraybuffer'));
}

/**
 * Grava XML + DANFSe PDF no Storage e devolve URLs/paths.
 * Mantém HTML só para preview interno (não é o artefato principal).
 */
async function salvarArtefatosNfseAbrasf({ admin, userId, chave, xmlRaw, meta }) {
  const xmlLimpo = extrairXmlNfse(xmlRaw);
  const fileKey = String(chave || `nfse-${Date.now()}`).replace(/[^\w.-]+/g, '_');
  let danfeUrl = null;
  let danfePath = null;
  let xmlPath = null;

  if (xmlLimpo) {
    xmlPath = `${userId}/${fileKey}.xml`;
    try {
      await admin.storage.from('nfe_xmls').upload(xmlPath, Buffer.from(xmlLimpo, 'utf8'), {
        contentType: 'application/xml',
        upsert: true,
      });
    } catch (e) {
      console.warn('[nfse] upload xml:', e?.message || e);
      xmlPath = null;
    }
  }

  const metaFull = enriquecerMetaDoXml(meta, xmlLimpo || xmlRaw);
  const html = buildDanfseHtml(metaFull);
  let pdfBuf = null;
  try {
    pdfBuf = buildDanfsePdfBuffer(metaFull);
  } catch (e) {
    console.warn('[nfse] build danfe pdf:', e?.message || e);
  }

  danfePath = `${userId}/${fileKey}.pdf`;
  const legacyHtmlPath = `${userId}/${fileKey}.html`;
  try {
    try {
      await admin.storage.from('nota_fiscal_danfe').remove([danfePath, legacyHtmlPath]);
    } catch {
      /* ignore */
    }
    if (pdfBuf && pdfBuf.length) {
      const { error } = await admin.storage
        .from('nota_fiscal_danfe')
        .upload(danfePath, pdfBuf, {
          contentType: 'application/pdf',
          upsert: true,
          cacheControl: '60',
        });
      if (!error) {
        const { data: pub } = admin.storage.from('nota_fiscal_danfe').getPublicUrl(danfePath);
        danfeUrl = pub?.publicUrl || null;
        if (danfeUrl) {
          danfeUrl = `${danfeUrl}${danfeUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
        }
      } else {
        console.warn('[nfse] upload danfe pdf:', error.message);
        danfePath = null;
      }
    } else {
      danfePath = null;
    }
  } catch (e) {
    console.warn('[nfse] upload danfe pdf:', e?.message || e);
    danfePath = null;
  }

  // Fallback: se PDF falhar, grava HTML (e-mail ainda tenta gerar PDF na hora do envio).
  if (!danfePath) {
    danfePath = legacyHtmlPath;
    try {
      const { error } = await admin.storage
        .from('nota_fiscal_danfe')
        .upload(danfePath, Buffer.from(html, 'utf8'), {
          contentType: 'text/html;charset=utf-8',
          upsert: true,
          cacheControl: '60',
        });
      if (!error) {
        const { data: pub } = admin.storage.from('nota_fiscal_danfe').getPublicUrl(danfePath);
        danfeUrl = pub?.publicUrl || null;
        if (danfeUrl) {
          danfeUrl = `${danfeUrl}${danfeUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
        }
      } else {
        console.warn('[nfse] upload danfe html fallback:', error.message);
        danfePath = null;
      }
    } catch (e) {
      console.warn('[nfse] upload danfe html fallback:', e?.message || e);
      danfePath = null;
    }
  }

  return {
    xml_autorizado: xmlLimpo,
    danfe_url: danfeUrl,
    danfe_storage_path: danfePath,
    xml_storage_path: xmlPath,
    html,
    pdf: pdfBuf,
  };
}

module.exports = {
  extrairXmlNfse,
  buildDanfseHtml,
  buildDanfsePdfBuffer,
  enriquecerMetaDoXml,
  formatCpfCnpj,
  formatEndereco,
  salvarArtefatosNfseAbrasf,
};
