/**
 * Gera HTML da DANFSe para impressão no app (expo-print / nova aba).
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
  const cli = nota.cliente?.nome_empresa || nota.cliente?.nome_cliente || '—';
  const dataEmi = String(nota.data_emissao ?? '').slice(0, 10);
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/><title>DANFSe ${esc(nota.numero)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111;font-size:13px}
h1{font-size:18px;margin:0 0 6px}.box{border:1px solid #333;padding:12px;margin-top:12px}
.val{font-size:20px;font-weight:700;margin-top:8px}.muted{color:#555;font-size:12px}
</style></head><body>
<h1>DANFSe — NFS-e Americana/SP</h1>
<div class="muted">Documento auxiliar para visualização e impressão</div>
<div class="box">
<strong>NFS-e</strong> Série ${esc(nota.serie)} / Nº ${esc(nota.numero)}<br/>
Competência: ${esc(nota.competencia || '—')} · Emissão: ${esc(dataEmi || '—')}<br/>
Código de verificação: <strong>${esc(nota.codigo_verificacao || '—')}</strong><br/>
<span class="muted">Chave/protocolo: ${esc(nota.chave_acesso || nota.protocolo_autorizacao || '—')}</span>
<div class="val">R$ ${esc(money(nota.valor_total))}</div>
</div>
<p><strong>Tomador:</strong> ${esc(cli)}</p>
<p><strong>Natureza/serviço:</strong> ${esc(nota.natureza_operacao || 'Prestação de serviços')}</p>
<p class="muted">Confira a autenticidade em nfse.americana.sp.gov.br › Verifique a Autenticidade.</p>
</body></html>`;
}
