/**
 * Fallback local: DANFSe no layout “Nota da Cidade” (Americana/SP).
 * Preferir o HTML gerado por POST /api/nfe/artefatos (dados completos).
 */

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0,00';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatData(iso: string | null | undefined) {
  const raw = String(iso ?? '').trim();
  if (!raw) return '—';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
  return raw.slice(0, 16);
}

export function buildDanfseHtmlFromNota(nota: {
  serie?: string | number | null;
  numero?: string | number | null;
  competencia?: string | null;
  data_emissao?: string | null;
  codigo_verificacao?: string | null;
  chave_acesso?: string | null;
  protocolo_autorizacao?: string | null;
  valor_total?: number | null;
  natureza_operacao?: string | null;
  cliente?: { nome_cliente?: string | null; nome_empresa?: string | null } | null;
}): string {
  const cli = nota.cliente?.nome_empresa || nota.cliente?.nome_cliente || '—';
  const dataEmi = formatData(nota.data_emissao);
  const numero = String(nota.protocolo_autorizacao || nota.numero || '—');
  const valor = money(nota.valor_total);
  const codVerif = nota.codigo_verificacao || '—';
  const disc = nota.natureza_operacao || 'Prestação de serviços';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"/>
<title>NFS-e ${esc(numero)} — Americana</title>
<style>
@page{size:A4;margin:10mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;padding:8px;font-size:10px;line-height:1.25}
.page{max-width:190mm;margin:0 auto;border:1.5px solid #000}
table{width:100%;border-collapse:collapse}
.pad{padding:4px 6px}.pad2{padding:6px 8px}
.br{border-right:1px solid #000}.bb{border-bottom:1px solid #000}
.lbl{font-size:8px;font-weight:700;text-transform:uppercase}
.val{font-size:11px;font-weight:700}
.header-title{font-size:13px;font-weight:800}
.section{background:#e8e8e8;font-size:10px;font-weight:800;text-align:center;padding:3px 6px;border-top:1px solid #000;border-bottom:1px solid #000;letter-spacing:.06em}
.total-bar{font-size:13px;font-weight:800;text-align:right;padding:8px 10px;border-top:2px solid #000}
.right{text-align:right}.center{text-align:center}.tiny{font-size:8px}.small{font-size:9px}
.noprint{margin-top:12px;text-align:center}
button{padding:10px 18px;font-size:14px;cursor:pointer;background:#1a3a4a;color:#fff;border:0;border-radius:4px}
@media print{.noprint{display:none!important}}
</style></head><body>
<div class="page">
<table>
<tr>
<td class="pad2 br" style="width:62%">
<div class="tiny">SECRETARIA MUNICIPAL DE FAZENDA</div>
<div class="header-title">NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e</div>
<div style="font-weight:700">- NOTA DA CIDADE -</div>
<div style="font-weight:700;margin-top:4px">MUNICÍPIO DE AMERICANA</div>
</td>
<td class="pad2" style="width:38%">
<table>
<tr><td class="lbl">Número da Nota</td><td class="val right">${esc(numero)}</td></tr>
<tr><td class="lbl">Data e Hora de Emissão</td><td class="val right">${esc(dataEmi)}</td></tr>
<tr><td class="lbl">Código de Verificação</td><td class="val right">${esc(codVerif)}</td></tr>
</table>
</td>
</tr>
</table>

<div class="section">PRESTADOR DE SERVIÇOS</div>
<div class="pad2 tiny">Dados do prestador conforme cadastro em Configurações › NFS-e (abra Imprimir após regenerar artefatos para o layout completo).</div>

<div class="section">TOMADOR DE SERVIÇOS</div>
<div class="pad2"><div class="lbl">Nome/Razão Social</div><div class="val">${esc(cli)}</div></div>

<div class="section">DISCRIMINAÇÃO DOS SERVIÇOS</div>
<div class="pad2" style="min-height:40px">${esc(disc)}</div>
<div class="pad2 right" style="border-top:1px solid #000;font-weight:700">Líquido a Receber R$ ${esc(valor)}</div>

<table>
<tr>
<th class="pad bb br tiny">Documento</th>
<th class="pad bb br tiny">Parcela</th>
<th class="pad bb br tiny">Valor</th>
<th class="pad bb tiny">Vencimento</th>
</tr>
<tr>
<td class="pad br">${esc(nota.numero)}</td>
<td class="pad br center">1</td>
<td class="pad br">R$ ${esc(valor)}</td>
<td class="pad">${esc(dataEmi)}</td>
</tr>
</table>

<div class="section">CÓDIGO DO SERVIÇO</div>
<div class="pad2">01.07 — conforme configuração fiscal do emitente</div>
<table>
<tr>
<th class="pad bb br tiny">Deduções</th>
<th class="pad bb br tiny">Desconto</th>
<th class="pad bb br tiny">Base</th>
<th class="pad bb br tiny">Alíquota</th>
<th class="pad bb br tiny">ISS</th>
<th class="pad bb tiny">Crédito IPTU</th>
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
- Esta NFS-e foi emitida com respaldo da Lei nº 4.930/2009 e no Decreto nº 8.250/2009.<br/>
- O ISS desta NFS-e deverá ser recolhido através do Documento de Arrecadação do Simples Nacional.<br/>
- (*) Documento emitido por ME ou EPP optante pelo SIMPLES NACIONAL.<br/>
- Esta NFS-e não gera crédito.<br/>
- Esta NFS-e substitui o RPS Nº ${esc(nota.numero)} Série ${esc(nota.serie)}, emitido em ${esc(dataEmi)}.
</div>
<div class="total-bar">VALOR TOTAL DA NOTA = R$ ${esc(valor)}</div>
</div>
<p class="noprint"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></p>
</body></html>`;
}
