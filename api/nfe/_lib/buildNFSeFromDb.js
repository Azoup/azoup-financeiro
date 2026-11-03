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
 * Monta DPS nacional (ADN) no leiaute de PRODUÇÃO (NT 004/007).
 *
 * Importante (CGNFS-e, 29/10/2026):
 * - Produção oficial ainda NÃO usa NT 009 (finNFSe em infDPS). NT 009 só em
 *   produção restrita até o cronograma de 01/12/2026.
 * - finNFSe na raiz de infDPS gera E1235 em produção.
 * - IBSCBS é opcional; se omitido, o ADN não rejeita por isso. Se informado,
 *   precisa do grupo completo em infDPS/IBSCBS (finNFSe, cIndOp, indDest…).
 * - Nunca colocar IBSCBS dentro de valores/trib.
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

  if (ibge === '3501608' && !onlyDigits(config.inscricao_municipal)) {
    throw new Error('Informe a Inscrição Municipal de Americana (ex.: 69842) em Configurações › NFS-e.');
  }

  // IBGE do tomador: se o cadastro trouxer, usa; senão, município do prestador.
  const cMunTomador = onlyDigits(cliente.codigo_ibge || cliente.cMun || cliente.codigo_municipio).slice(0, 7);
  const cMunToma = cMunTomador.length === 7 ? cMunTomador : ibge;

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
            // Ordem do schema: CEP antes de cMun.
            endNac: {
              CEP: cepTomador.padStart(8, '0').slice(0, 8),
              cMun: cMunToma,
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
