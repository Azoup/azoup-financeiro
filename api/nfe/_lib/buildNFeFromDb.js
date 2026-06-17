function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function padNcm(ncm) {
  const d = onlyDigits(ncm).padStart(8, '0').slice(0, 8);
  return d;
}

function buildNFeLayout({ nota, itens, pagamentos, perfil, cliente, config }) {
  const emitDoc = onlyDigits(perfil.documento);
  const destDoc = onlyDigits(cliente.documento);
  const isCnpjEmit = emitDoc.length === 14;
  const isCnpjDest = destDoc.length === 14;

  const dhEmi = new Date(nota.data_emissao).toISOString();
  const descricaoBase = itens[0]?.descricao ?? config.descricao_servico_padrao;
  const descricao =
    Number(nota.ambiente) === 2
      ? `NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL - ${descricaoBase}`
      : descricaoBase;

  const det = itens.map((item, idx) => ({
    nItem: idx + 1,
    prod: {
      cProd: String(item.numero_item),
      cEAN: 'SEM GTIN',
      xProd: idx === 0 ? descricao : item.descricao,
      NCM: padNcm(item.ncm),
      CFOP: item.cfop,
      uCom: item.unidade,
      qCom: Number(item.quantidade),
      vUnCom: Number(item.valor_unitario),
      vProd: Number(item.valor_total),
      cEANTrib: 'SEM GTIN',
      uTrib: item.unidade,
      qTrib: Number(item.quantidade),
      vUnTrib: Number(item.valor_unitario),
      indTot: 1,
    },
    imposto: {
      ICMS: {
        ICMSSN102: {
          orig: 0,
          CSOSN: item.csosn ?? config.csosn ?? '102',
        },
      },
      PIS: { PISNT: { CST: item.cst_pis ?? '07' } },
      COFINS: { COFINSNT: { CST: item.cst_cofins ?? '07' } },
    },
  }));

  const vProd = det.reduce((s, d) => s + Number(d.prod.vProd), 0);
  const vNF = vProd;

  return {
    ide: {
      cUF: 35,
      natOp: nota.natureza_operacao,
      mod: 55,
      serie: Number(nota.serie) || 1,
      nNF: nota.numero,
      dhEmi,
      tpNF: 1,
      idDest: perfil.uf?.trim().toUpperCase() === cliente.uf?.trim().toUpperCase() ? 1 : 2,
      cMunFG: Number(config.codigo_ibge_emitente),
      tpImp: 1,
      tpEmis: 1,
      tpAmb: Number(nota.ambiente),
      finNFe: 1,
      indFinal: 1,
      indPres: 9,
      procEmi: 0,
      verProc: 'SistemaJessica-1.0',
    },
    emit: {
      ...(isCnpjEmit ? { CNPJ: emitDoc } : { CPF: emitDoc }),
      xNome: perfil.razao_social,
      xFant: perfil.razao_social,
      enderEmit: {
        xLgr: perfil.logradouro,
        nro: perfil.numero || 'S/N',
        xBairro: perfil.bairro || 'Centro',
        cMun: Number(config.codigo_ibge_emitente),
        xMun: perfil.cidade,
        UF: perfil.uf?.trim().toUpperCase().slice(0, 2),
        CEP: onlyDigits(perfil.cep).padStart(8, '0'),
        cPais: 1058,
        xPais: 'BRASIL',
      },
      IE: config.inscricao_estadual || 'ISENTO',
      CRT: config.regime_tributario ?? 1,
    },
    dest: {
      ...(isCnpjDest ? { CNPJ: destDoc } : { CPF: destDoc }),
      xNome: cliente.nome_cliente,
      enderDest: {
        xLgr: cliente.logradouro || 'Não informado',
        nro: cliente.numero || 'S/N',
        xBairro: cliente.bairro || 'Centro',
        cMun: Number(config.codigo_ibge_emitente),
        xMun: cliente.cidade || perfil.cidade,
        UF: (cliente.uf || perfil.uf || 'SP').trim().toUpperCase().slice(0, 2),
        CEP: onlyDigits(cliente.cep || perfil.cep).padStart(8, '0'),
        cPais: 1058,
        xPais: 'BRASIL',
      },
      indIEDest: 9,
    },
    det,
    total: {
      ICMSTot: {
        vBC: 0,
        vICMS: 0,
        vICMSDeson: 0,
        vFCP: 0,
        vBCST: 0,
        vST: 0,
        vFCPST: 0,
        vFCPSTRet: 0,
        vProd,
        vFrete: 0,
        vSeg: 0,
        vDesc: 0,
        vII: 0,
        vIPI: 0,
        vIPIDevol: 0,
        vPIS: 0,
        vCOFINS: 0,
        vOutro: 0,
        vNF,
      },
    },
    transp: { modFrete: 9 },
    pag: {
      detPag: (pagamentos.length ? pagamentos : [{ forma_pagamento: '99', valor: vNF }]).map((p) => ({
        tPag: p.forma_pagamento || '99',
        vPag: Number(p.valor),
      })),
    },
  };
}

module.exports = { buildNFeLayout, onlyDigits };
