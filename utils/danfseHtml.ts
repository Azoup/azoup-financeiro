/**
 * Gera HTML da DANFSe para impressão no app (blob URL / expo-print).
 */
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
  const esc = (s: unknown) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const money = (n: unknown) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0,00';
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const cli = nota.cliente?.nome_empresa || nota.cliente?.nome_cliente || '-';
  const dataEmi = String(nota.data_emissao ?? '').slice(0, 10);
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>DANFSe ${esc(nota.numero)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111;font-size:13px}
h1{font-size:18px;margin:0 0 6px}.box{border:1px solid #333;padding:12px;margin-top:12px}
.val{font-size:20px;font-weight:700;margin-top:8px}.muted{color:#555;font-size:12px}
@media print{.noprint{display:none}}
button{margin-top:16px;padding:10px 16px;font-size:14px;cursor:pointer}
</style></head><body>
<h1>DANFSe - NFS-e Americana/SP</h1>
<div class="muted">Documento auxiliar para visualizacao e impressao</div>
<div class="box">
<strong>NFS-e</strong> Serie ${esc(nota.serie)} / No ${esc(nota.numero)}<br/>
Competencia: ${esc(nota.competencia || '-')} - Emissao: ${esc(dataEmi || '-')}<br/>
Codigo de verificacao: <strong>${esc(nota.codigo_verificacao || '-')}</strong><br/>
<span class="muted">Chave/protocolo: ${esc(nota.chave_acesso || nota.protocolo_autorizacao || '-')}</span>
<div class="val">R$ ${esc(money(nota.valor_total))}</div>
</div>
<p><strong>Tomador:</strong> ${esc(cli)}</p>
<p><strong>Natureza/servico:</strong> ${esc(nota.natureza_operacao || 'Prestacao de servicos')}</p>
<p class="muted">Autenticidade: nfse.americana.sp.gov.br &gt; Verifique a Autenticidade.</p>
<p class="noprint"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></p>
</body></html>`;
}
