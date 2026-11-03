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
  return (cliente.nome || cliente.razao_social || cliente.nome_empresa || cliente.nome_fantasia || cliente.nome_cliente || '').trim();
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

/**
 * Monta DPS nacional (ADN/SEFIN) no leiaute de PRODUÇÃO (NT 004/007).
 *
 * - Sem finNFSe na raiz de infDPS (NT 009 ainda não é produção plena → E1235).
 * - Sem IBSCBS (opcional no ADN; omitido evita E1235 via nfewizard).
 * - Simples MEI/ME-EPP: regApTribSN=1 ANTES de regEspTrib (TCRegTrib / E0039).
 */
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

  const serieNum = Number(String(nota.serie || config.serie || '1').replace(/\D/g, '') || '1');
  if (!Number.isFinite(serieNum) || serieNum < 1 || serieNum >= 99999) {
    throw new Error(
      'Série do RPS inválida para Americana: use número entre 1 e 99998 (a série 99999 é reservada ao site da prefeitura).',
    );
  }

  let cTribMun = padTribMun(config.codigo_tributacao_municipal);
  if (!cTribMun && ibge === '3501608') {
    cTribMun = '001';
  }

  // SEFIN não exige IM; só inclui se cadastrada.
  const im = onlyDigits(config.inscricao_municipal);

  // IBGE do tomador: se o cadastro trouxer, usa; senão, município do prestador.
  const cMunTomador = onlyDigits(cliente.codigo_ibge || cliente.cMun || cliente.codigo_municipio).slice(0, 7);
  const cMunToma = cMunTomador.length === 7 ? cMunTomador : ibge;

  const opSimpNac = Number(config.op_simp_nac ?? 1);
  // xml2js preserva ordem das chaves; TCRegTrib exige regApTribSN antes de regEspTrib (DPS_v1.01).
  const regTrib = {
    opSimpNac,
    ...(opSimpNac === 2 || opSimpNac === 3
      ? { regApTribSN: Number(config.reg_ap_trib_sn ?? 1) }
      : {}),
    regEspTrib: Number(config.reg_esp_trib ?? 0),
  };

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
          ...(im ? { IM: im } : {}),
          regTrib,
        },
        toma: {
          ...(isCnpjDest ? { CNPJ: destDoc } : { CPF: destDoc }),
          xNome: tomadorNome,
          end: {
            // TCEnderNac (DPS_v1.01): cMun antes de CEP.
            endNac: {
              cMun: cMunToma,
              CEP: cepTomador.padStart(8, '0').slice(0, 8),
            },
            xLgr: cliente.logradouro || perfil.logradouro || 'Nao informado',
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
        },
        valores: {
          vServPrest: { vServ: money2(valor) },
          trib: {
            tribMun: {
              tribISSQN: tribMun,
              tpRetISSQN: Number(config.tp_ret_issqn ?? 1),
            },
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

module.exports = { buildNFSeLayout };
