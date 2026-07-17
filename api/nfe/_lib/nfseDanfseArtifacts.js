/**
 * Artefatos pós-autorização ABRASF: XML limpo + DANFSe HTML imprimível.
 */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moneyBr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0,00';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Extrai CompNfse / Nfse do retorno SOAP TipLan. */
function extrairXmlNfse(xmlRaw) {
  const raw = String(xmlRaw ?? '');
  if (!raw.trim()) return null;
  const comp = raw.match(/<CompNfse[\s\S]*?<\/CompNfse>/i);
  if (comp) return `<?xml version="1.0" encoding="UTF-8"?>\n${comp[0]}`;
  const nfse = raw.match(/<Nfse[\s\S]*?<\/Nfse>/i);
  if (nfse) return `<?xml version="1.0" encoding="UTF-8"?>\n${nfse[0]}`;
  // Fallback: resposta completa já decodificada
  if (/InfNfse|CodigoVerificacao/i.test(raw)) return raw;
  return raw;
}

function buildDanfseHtml({
  prestadorNome,
  prestadorDoc,
  prestadorIm,
  tomadorNome,
  tomadorDoc,
  numero,
  serie,
  codigoVerificacao,
  chaveAcesso,
  discriminacao,
  valor,
  itemLista,
  competencia,
  dataEmissao,
}) {
  const titulo = 'DANFSe — Documento Auxiliar da NFS-e';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(titulo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px}
  h1{font-size:18px;margin:0 0 4px}
  h2{font-size:14px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}
  .muted{color:#555;font-size:12px}
  .box{border:1px solid #333;padding:12px;margin-top:12px}
  .row{display:flex;gap:16px;flex-wrap:wrap}
  .col{flex:1;min-width:200px}
  .val{font-size:20px;font-weight:700;margin-top:8px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  td,th{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}
  @media print{body{margin:12px}}
</style>
</head>
<body>
  <h1>${escapeHtml(titulo)}</h1>
  <div class="muted">Prefeitura Municipal de Americana/SP · NFS-e eletrônica</div>
  <div class="box">
    <div class="row">
      <div class="col">
        <strong>NFS-e</strong><br/>
        Série ${escapeHtml(serie)} / Nº ${escapeHtml(numero)}<br/>
        Competência: ${escapeHtml(competencia || '—')}<br/>
        Emissão: ${escapeHtml(dataEmissao || '—')}
      </div>
      <div class="col">
        <strong>Código de verificação</strong><br/>
        ${escapeHtml(codigoVerificacao || '—')}<br/>
        <span class="muted">Chave/protocolo: ${escapeHtml(chaveAcesso || '—')}</span>
      </div>
    </div>
    <div class="val">R$ ${escapeHtml(moneyBr(valor))}</div>
  </div>
  <h2>Prestador</h2>
  <div>${escapeHtml(prestadorNome || '—')}<br/>
  CNPJ ${escapeHtml(prestadorDoc || '—')} · IM ${escapeHtml(prestadorIm || '—')}</div>
  <h2>Tomador</h2>
  <div>${escapeHtml(tomadorNome || '—')}<br/>
  CPF/CNPJ ${escapeHtml(tomadorDoc || '—')}</div>
  <h2>Serviço</h2>
  <table>
    <tr><th>Item lista</th><td>${escapeHtml(itemLista || '—')}</td></tr>
    <tr><th>Discriminação</th><td>${escapeHtml(discriminacao || 'Prestação de serviços')}</td></tr>
  </table>
  <p class="muted" style="margin-top:20px">
    A autenticidade pode ser conferida em nfse.americana.sp.gov.br › Verifique a Autenticidade,
    informando CNPJ do prestador, número da NFS-e e código de verificação.
  </p>
  <script>window.onload=function(){try{window.print()}catch(e){}}</script>
</body>
</html>`;
}

/**
 * Grava XML + DANFSe HTML no Storage e devolve URLs/paths.
 */
async function salvarArtefatosNfseAbrasf({
  admin,
  userId,
  chave,
  xmlRaw,
  meta,
}) {
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

  const html = buildDanfseHtml(meta);
  danfePath = `${userId}/${fileKey}.html`;
  try {
    const { error } = await admin.storage
      .from('nota_fiscal_danfe')
      .upload(danfePath, Buffer.from(html, 'utf8'), {
        contentType: 'text/html; charset=utf-8',
        upsert: true,
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
  };
}

module.exports = {
  extrairXmlNfse,
  buildDanfseHtml,
  salvarArtefatosNfseAbrasf,
};
