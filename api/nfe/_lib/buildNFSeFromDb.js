const { onlyDigits } = require('./buildNFeFromDb');

function parseCompetenciaIso(competencia, fallbackDate) {
  const raw = String(competencia ?? '').trim();
  const m1 = raw.match(/^(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[2]}-${m1[1]}-01`;
  const m2 = raw.match(/^(\d{4})-(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-01`;
  const d = fallbackDate ? new Date(fallbackDate) : new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${mo}-${String(d.getDate()).padStart(2, '0')}`;
}

function dhEmiBr(isoDate) {
  const d = new Date(isoDate ?? Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const off = -3;
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const br = new Date(utc + off * 3600000);
  return `${br.getFullYear()}-${pad(br.getMonth() + 1)}-${pad(br.getDate())}T${pad(br.getHours())}:${pad(br.getMinutes())}:${pad(br.getSeconds())}-03:00`;
}

function nomeCliente(cliente) {
  return (cliente.nome_fantasia || cliente.nome_cliente || cliente.nome || '').trim();
}

function ufCliente(cliente) {
  return cliente.estado || cliente.uf || '';
}

function padTribNac(code) {
  return onlyDigits(code).padStart(6, '0').slice(0, 6);
}

function padTribMun(code) {
  const d = onlyDigits(code);
  if (!d) return '';
  return d.slice(0, 3);
}

function padNbs(code) {
  return onlyDigits(code).padStart(9, '0').slice(0, 9);
}

/** Valores monetários NFS-e (TSDec15V2): sempre 2 casas decimais, ex. "0.20". */
function money2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return (Math.round(v * 100) / 100).toFixed(2);
}

/** Monta DPS/NFS-e nacional a partir dos dados do banco (mensalidade = serviço). */
function buildNFSeLayout({ nota, itens, perfil, cliente, config }) {
  const ambiente = 1; // produção
  const ibge = onlyDigits(config.codigo_ibge_emitente).slice(0, 7);
  if (ibge.length < 7) {
    throw new Error('Código IBGE do município do prestador inválido (7 dígitos).');
  }

  const emitDoc = onlyDigits(perfil.documento);
  const destDoc = onlyDigits(cliente.cnpj) || onlyDigits(cliente.documento);
  if (emitDoc.length !== 11 && emitDoc.length !== 14) {
    throw new Error('Documento do beneficiário (emitente) inválido. Preencha CPF ou CNPJ em Configurações.');
  }
  if (destDoc.length !== 11 && destDoc.length !== 14) {
    throw new Error(
      `Cliente "${nomeCliente(cliente)}" sem CPF/CNPJ válido no cadastro. Informe o documento antes de emitir NFS-e.`,
    );
  }
  const isCnpjEmit = emitDoc.length === 14;
  const isCnpjDest = destDoc.length === 14;

  const cepTomador = onlyDigits(cliente.cep || perfil.cep);
  if (cepTomador.length < 8) {
    throw new Error('CEP do tomador ausente. Preencha o endereço do cliente ou do beneficiário.');
  }

  const descricaoBase = itens[0]?.descricao ?? config.descricao_servico_padrao;
  const xDescServ = descricaoBase;

  const tomadorNome = nomeCliente(cliente);

  const valor = Number(nota.valor_total);
  const tribMun = Number(config.trib_issqn ?? 1);
  const vMun = tribMun === 1 ? money2(valor * 0.04) : money2(0);

  // Manual Americana: série numérica 1–99998 (99999 reservada ao emissor online).
  const serieNum = Number(String(nota.serie || config.serie || '1').replace(/\D/g, '') || '1');
  if (!Number.isFinite(serieNum) || serieNum < 1 || serieNum >= 99999) {
    throw new Error(
      'Série do RPS inválida para Americana: use número entre 1 e 99998 (a série 99999 é reservada ao site da prefeitura).',
    );
  }

  // cTribMun: complementar municipal (até 3 dígitos em ADN). Americana costuma exigir (ex.: 001).
  // São Paulo capital usa Paulistana (outro fluxo) — não monta DPS nacional.
  let cTribMun = padTribMun(config.codigo_tributacao_municipal);
  if (!cTribMun && ibge === '3501608') {
    cTribMun = '001';
  }

  if (ibge === '3501608' && !onlyDigits(config.inscricao_municipal)) {
    throw new Error('Informe a Inscrição Municipal de Americana (ex.: 69842) em Configurações › NFS-e.');
  }

  return {
    DPS: {
      infDps: {
        tpAmb: ambiente,
        dhEmi: dhEmiBr(nota.data_emissao),
        verAplic: 'SistemaJessica-1.0',
        serie: String(serieNum),
        nDPS: String(nota.numero),
        dCompet: parseCompetenciaIso(nota.competencia, nota.data_emissao),
        tpEmit: 1,
        cLocEmi: ibge,
        prest: {
          ...(isCnpjEmit ? { CNPJ: emitDoc } : { CPF: emitDoc }),
          ...(config.inscricao_municipal?.trim()
            ? { IM: onlyDigits(config.inscricao_municipal) }
            : {}),
          regTrib: {
            opSimpNac: Number(config.op_simp_nac ?? 1),
            regEspTrib: Number(config.reg_esp_trib ?? 0),
          },
        },
        toma: {
          ...(isCnpjDest ? { CNPJ: destDoc } : { CPF: destDoc }),
          xNome: tomadorNome,
          end: {
            endNac: {
              cMun: ibge,
              CEP: cepTomador.padStart(8, '0').slice(0, 8),
            },
            xLgr: cliente.logradouro || perfil.logradouro || 'Não informado',
            nro: cliente.numero || perfil.numero || 'S/N',
            xBairro: cliente.bairro || perfil.bairro || 'Centro',
          },
        },
        serv: {
          locPrest: { cLocPrestacao: ibge },
          cServ: {
            cTribNac: padTribNac(config.codigo_tributacao_nacional),
            ...(cTribMun ? { cTribMun } : {}),
            xDescServ,
            cNBS: padNbs(config.codigo_nbs),
          },
          /** IndOp — indicador da operação (reforma / layout municipal). */
          indOp: String(config.ind_op ?? '100501').replace(/\D/g, '').slice(0, 10) || '100501',
        },
        valores: {
          vServPrest: { vServ: money2(valor) },
          trib: {
            tribMun: {
              tribISSQN: tribMun,
              tpRetISSQN: Number(config.tp_ret_issqn ?? 1),
            },
            // Reforma tributária IBS/CBS (teste 2026).
            IBSCBS: buildIbsCbs(config, valor),
            totTrib: {
              vTotTrib: {
                vTotTribFed: money2(0),
                vTotTribEst: money2(0),
                vTotTribMun: vMun,
              },
            },
          },
        },
      },
    },
  };
}

/** Grupo IBSCBS da DPS nacional (CST / cClassTrib / alíquotas teste 2026). */
function buildIbsCbs(config, valorServico) {
  const cst = String(config.cst_ibs_cbs ?? '000').replace(/\D/g, '').padStart(3, '0').slice(0, 3);
  const cClassTrib = String(config.c_class_trib ?? '000001')
    .replace(/\D/g, '')
    .padStart(6, '0')
    .slice(0, 6);
  const pIBSUF = Number(config.aliquota_ibs_uf ?? 0.1);
  const pIBSMun = Number(config.aliquota_ibs_mun ?? 0);
  const pCBS = Number(config.aliquota_cbs ?? 0.9);
  const vBC = Number(valorServico);
  const vIBSUF = Math.round(vBC * (pIBSUF / 100) * 100) / 100;
  const vIBSMun = Math.round(vBC * (pIBSMun / 100) * 100) / 100;
  const vCBS = Math.round(vBC * (pCBS / 100) * 100) / 100;

  return {
    CST: cst || '000',
    cClassTrib: cClassTrib || '000001',
    gIBSCBS: {
      vBC: money2(vBC),
      gIBSUF: {
        pIBSUF: Number.isFinite(pIBSUF) ? pIBSUF : 0.1,
        vIBSUF: money2(vIBSUF),
      },
      gIBSMun: {
        pIBSMun: Number.isFinite(pIBSMun) ? pIBSMun : 0,
        vIBSMun: money2(vIBSMun),
      },
      gCBS: {
        pCBS: Number.isFinite(pCBS) ? pCBS : 0.9,
        vCBS: money2(vCBS),
      },
    },
  };
}

module.exports = { buildNFSeLayout };
