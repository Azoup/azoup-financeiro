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
  const rua = [logradouro, numero].filter(Boolean).join(' ').trim();
  if (rua) parts.push(rua);
  if (bairro) parts.push(bairro);
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
  return {
    ...meta,
    numero: nInf || numero || meta.numero,
    codigoVerificacao: codVerif,
    dataEmissao,
    discriminacao,
    itemLista,
    valor: valorServicos ? Number(valorServicos) : meta.valor,
  };
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
    'O ISS desta NFS-e deverá ser recolhido através do Documento de Arrecadação do Simples Nacional.',
    '(*) Documento emitido por ME ou EPP optante pelo SIMPLES NACIONAL.',
    'Esta NFS-e não gera crédito.',
  ];
  if (rpsNum) {
    outras.push(
      `Esta NFS-e substitui o RPS Nº ${rpsNum} Série ${rpsSerie}, emitido em ${rpsData}.`,
    );
  }
  if (m.outrasInformacoes) {
    outras.push(String(m.outrasInformacoes));
  }

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
 * Grava XML + DANFSe HTML no Storage e devolve URLs/paths.
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
  danfePath = `${userId}/${fileKey}.html`;
  try {
    try {
      await admin.storage.from('nota_fiscal_danfe').remove([danfePath]);
    } catch {
      /* ignore */
    }
    const { error } = await admin.storage
      .from('nota_fiscal_danfe')
      .upload(danfePath, Buffer.from(`\uFEFF${html}`, 'utf8'), {
        contentType: 'text/html; charset=utf-8',
        upsert: true,
        cacheControl: '60',
      });
    if (!error) {
      const { data: pub } = admin.storage.from('nota_fiscal_danfe').getPublicUrl(danfePath);
      danfeUrl = pub?.publicUrl || null;
    } else {
      console.warn('[nfse] upload danfe html:', error.message);
      danfePath = null;
    }
  } catch (e) {
    console.warn('[nfse] upload danfe html:', e?.message || e);
    danfePath = null;
  }

  return {
    xml_autorizado: xmlLimpo,
    danfe_url: danfeUrl,
    danfe_storage_path: danfePath,
    xml_storage_path: xmlPath,
    html,
  };
}

module.exports = {
  extrairXmlNfse,
  buildDanfseHtml,
  enriquecerMetaDoXml,
  formatCpfCnpj,
  formatEndereco,
  salvarArtefatosNfseAbrasf,
};
