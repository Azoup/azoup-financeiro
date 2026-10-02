import type { BoletoParcelaVendaRow } from '@/types/contasReceber';
import { formatBRL } from '@/utils/currency';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function brl(n: number): string {
  return esc(formatBRL(n));
}

const ITF: Record<string, string> = {
  '0': 'nnwwn',
  '1': 'wnnnw',
  '2': 'nwnnw',
  '3': 'wwnnn',
  '4': 'nnwnw',
  '5': 'wnwnn',
  '6': 'nwwnn',
  '7': 'nnnww',
  '8': 'wnnwn',
  '9': 'nwnwn',
};

/** Código de barras ITF (Febraban, 44 dígitos) para o cliente pagar pelo mesmo título. */
function barcodeSvg(codigo: string): string {
  const digits = codigo.replace(/\D/g, '');
  if (digits.length < 2 || digits.length % 2 !== 0) return '';
  if ([...digits].some((d) => !ITF[d])) return '';
  const narrow = 1;
  const wide = 3;
  const seq: { bar: boolean; w: number }[] = [
    { bar: true, w: narrow },
    { bar: false, w: narrow },
    { bar: true, w: narrow },
    { bar: false, w: narrow },
  ];
  for (let i = 0; i < digits.length; i += 2) {
    const bars = ITF[digits[i]];
    const spaces = ITF[digits[i + 1]];
    for (let j = 0; j < 5; j += 1) {
      seq.push({ bar: true, w: bars[j] === 'w' ? wide : narrow });
      seq.push({ bar: false, w: spaces[j] === 'w' ? wide : narrow });
    }
  }
  seq.push({ bar: true, w: wide }, { bar: false, w: narrow }, { bar: true, w: narrow });
  let x = 0;
  const rects: string[] = [];
  for (const s of seq) {
    if (s.bar) rects.push(`<rect x="${x}" y="0" width="${s.w}" height="46" fill="#000"/>`);
    x += s.w;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} 46" width="100%" height="52" preserveAspectRatio="none" role="img" aria-label="Código de barras">${rects.join('')}</svg>`;
}

/** Carnê no estilo boleto; quando registrado exibe linha digitável e código de barras. */
export function buildBoletoCobrancaHtml(row: BoletoParcelaVendaRow): string {
  const registrado = row.status_registro === 'registrado' || row.status_registro === 'pago';
  const banco =
    row.tipo_emissao === 'c6' ? 'C6 Bank' : row.tipo_emissao === 'sicoob' ? 'Sicoob' : null;
  const nossoNumero = registrado && row.nosso_numero_banco ? row.nosso_numero_banco : row.nosso_numero;
  const avisoTopo = registrado
    ? `Boleto registrado${banco ? ` no ${banco}` : ''}. Pague pela linha digitável ou pelo código de barras. O nome do pagador é o da empresa.`
    : 'Documento de cobrança para controle interno — não é boleto registrado em instituição financeira (sem compensação automática).';
  const barras = registrado && row.codigo_barras ? barcodeSvg(row.codigo_barras) : '';
  const venc = esc(row.data_vencimento.split('-').reverse().join('/'));
  const doc = esc(row.data_documento.split('-').reverse().join('/'));
  const desconto = brl(0);
  const outrosDesc = brl(0);
  const mora = brl(0);
  const outrosAcr = brl(0);
  const valorCobrado = brl(row.valor_documento);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Boleto ${esc(row.numero_documento)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 16px; background: #fff; }
    .muted { color: #555; font-size: 9px; }
    .grid3 { display: table; width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    .grid3 > div { display: table-cell; border: 1px solid #000; padding: 4px 6px; vertical-align: top; width: 33.33%; }
    .lbl { font-size: 8px; color: #333; text-transform: uppercase; margin-bottom: 2px; }
    .val { font-weight: 700; font-size: 12px; }
    .row2 { display: table; width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    .row2 > div { display: table-cell; border: 1px solid #000; padding: 4px 6px; width: 50%; }
    .full { border: 1px solid #000; padding: 4px 6px; margin-bottom: 6px; }
    .ficha { margin-top: 20px; border-top: 2px dashed #000; padding-top: 12px; }
    .tit { font-weight: 700; font-size: 10px; margin-bottom: 8px; }
    hr.sep { border: none; border-top: 1px solid #ccc; margin: 10px 0; }
  </style>
</head>
<body>
  <p class="muted">${avisoTopo}</p>
  ${
    registrado && row.linha_digitavel
      ? `<div class="full"><div class="lbl">Linha digitável</div><strong style="font-size:13px;letter-spacing:0.5px">${esc(row.linha_digitavel)}</strong></div>`
      : ''
  }
  ${
    barras
      ? `<div class="full" style="padding:8px 6px 4px"><div class="lbl">Código de barras</div>${barras}<div style="font-family:monospace;font-size:10px;margin-top:4px">${esc(row.codigo_barras ?? '')}</div></div>`
      : registrado && row.codigo_barras
        ? `<div class="full"><div class="lbl">Código de barras</div><span style="font-family:monospace;font-size:11px">${esc(row.codigo_barras)}</span></div>`
        : ''
  }

  <div class="grid3">
    <div><div class="lbl">Beneficiário</div><div>${esc(row.beneficiario_razao_social)}<br/><span style="font-weight:400;font-size:10px">${esc(row.beneficiario_documento)}</span></div></div>
    <div><div class="lbl">Vencimento</div><div class="val">${venc}</div></div>
    <div><div class="lbl">Valor do Documento</div><div class="val">${brl(row.valor_documento)}</div></div>
  </div>
  <div class="row2">
    <div><div class="lbl">(-) Desconto / Abatimento</div>${desconto}</div>
    <div><div class="lbl">(-) Outras deduções</div>${outrosDesc}</div>
  </div>
  <div class="row2">
    <div><div class="lbl">(+) Mora / Multa</div>${mora}</div>
    <div><div class="lbl">(+) Outros acréscimos</div>${outrosAcr}</div>
  </div>
  <div class="full"><div class="lbl">(=) Valor cobrado</div><div class="val">${valorCobrado}</div></div>

  <div class="full">
    <div class="lbl">Nome do pagador / Número do Documento</div>
    <strong>${esc(row.pagador_nome)}</strong> &nbsp;·&nbsp; ${esc(row.numero_documento)}
  </div>
  <div class="full">
    <div class="lbl">Endereço</div>${esc(row.pagador_endereco)}
  </div>
  <div class="full">
    <div class="lbl">Município / UF / CEP</div>${esc(row.pagador_cidade_uf_cep)}
  </div>
  ${
    row.mensagem_pagador
      ? `<div class="full"><div class="lbl">Mensagem Pagador / Dados do Pagador</div>${esc(row.mensagem_pagador)}</div>`
      : ''
  }

  <div class="full">
    <div class="lbl">Local de pagamento</div>${esc(row.local_pagamento)}
  </div>
  <div class="full">
    <div class="lbl">Beneficiário (repetição)</div>${esc(row.beneficiario_razao_social)} — ${esc(row.beneficiario_documento)}
  </div>
  <div class="row2">
    <div><div class="lbl">Data do documento</div>${doc}</div>
    <div><div class="lbl">Nosso número</div><strong>${esc(nossoNumero)}</strong></div>
  </div>
  <div class="full">
    <div class="lbl">Uso do banco / Espécie</div>Real &nbsp;·&nbsp; Quantidade: 1 &nbsp;·&nbsp; Valor: ${brl(0)}
  </div>
  <div class="full">
    <div class="lbl">Instruções (texto de responsabilidade do beneficiário)</div>
    <div style="white-space:pre-wrap">${esc(row.instrucoes)}</div>
  </div>
  <div class="full">
    <div class="lbl">Descrição da venda (referência)</div>
    <div style="white-space:pre-wrap">${esc(row.venda_descricao_resumo)}</div>
  </div>
  <div class="full">
    <div class="lbl">Pagador / Beneficiário final</div>
    ${esc(row.pagador_nome)}<br/>${esc(row.pagador_documento)}<br/>${esc(row.pagador_endereco)}<br/>${esc(row.pagador_cidade_uf_cep)}
  </div>
  ${
    row.cooperativa_rodape
      ? `<div class="full muted">${esc(row.cooperativa_rodape)}</div>`
      : ''
  }

  <div class="ficha">
    <div class="tit">${registrado ? `Ficha de compensação${banco ? ` (${banco})` : ''}` : 'Ficha de compensação (informativa)'}</div>
    <div class="grid3">
      <div><div class="lbl">Vencimento</div><div class="val">${venc}</div></div>
      <div><div class="lbl">Nosso número</div><strong>${esc(nossoNumero)}</strong></div>
      <div><div class="lbl">Valor documento</div><div class="val">${brl(row.valor_documento)}</div></div>
    </div>
    <div class="row2">
      <div><div class="lbl">(-) Desconto / Abatimento</div>${desconto}</div>
      <div><div class="lbl">(-) Outras deduções</div>${outrosDesc}</div>
    </div>
    <div class="row2">
      <div><div class="lbl">(+) Mora / Multa</div>${mora}</div>
      <div><div class="lbl">(+) Outros acréscimos</div>${outrosAcr}</div>
    </div>
    <div class="full"><div class="lbl">(=) Valor cobrado</div><div class="val">${valorCobrado}</div></div>
    <div class="row2">
      <div><div class="lbl">N. documento</div>${esc(row.numero_documento)}</div>
      <div><div class="lbl">Data processamento</div>${doc}</div>
    </div>
    <div class="full"><div class="lbl">Pagador</div>${esc(row.pagador_nome)}</div>
    <div class="full"><div class="lbl">Beneficiário</div>${esc(row.beneficiario_razao_social)}</div>
    <div class="full muted">Autenticação mecânica — recibo do pagador (preenchimento manual após recebimento, se aplicável).</div>
  </div>
</body>
</html>`;
}
