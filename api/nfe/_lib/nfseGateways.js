/**
 * Roteamento de emissão NFS-e por município (IBGE).
 * - 3550308 São Paulo capital → WebService Paulistana (SOAP)
 * - 3501608 Americana + Regime Normal → WebService ABRASF TipLan (SOAP)
 * - 3501608 Americana + Simples Nacional (ME/EPP/MEI) → SEFIN Emissor Nacional (ADN)
 *   (SEFIN: opSimpNac=2|3 + regApTribSN=1, sem IBSCBS/finNFSe na raiz em prod)
 * - demais → SEFIN Nacional (ADN)
 */
const AMERICANA_ADN = {
  H: {
    NFSe_Autorizacao: 'https://americanahomologacao.nfe.com.br/api/adn/dps/recepcao',
    NFSe_Eventos: 'https://americanahomologacao.nfe.com.br/api/adn/dps/evento',
    NFSe_Ws: 'https://americanahomologacao.nfe.com.br/nfse/wsnacional2/nfse.asmx',
  },
  P: {
    NFSe_Autorizacao: 'https://nfse.americana.sp.gov.br/api/adn/dps/recepcao',
    NFSe_Eventos: 'https://nfse.americana.sp.gov.br/api/adn/dps/evento',
    NFSe_Ws: 'https://nfse.americana.sp.gov.br/nfse/wsnacional2/nfse.asmx',
  },
};

const GATEWAYS_BY_IBGE = {
  '3550308': {
    nome: 'São Paulo/SP — Nota Fiscal Paulistana',
    mode: 'paulistana',
    skipConvenioNacional: true,
    urlOverrides: null,
  },
  '3501608': {
    nome: 'Americana/SP — WebService ABRASF TipLan',
    mode: 'abrasf',
    skipConvenioNacional: true,
    ...AMERICANA_ADN,
  },
};

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function normalizeIbge(ibge) {
  return onlyDigits(ibge).padStart(7, '0').slice(0, 7);
}

/** ME/EPP/MEI optante (ou pendente) do Simples — deve emitir pelo ADN nacional. */
function isOptanteSimplesNacional(config) {
  const regime = Number(config?.regime_tributario ?? 0);
  const opSimp = Number(config?.op_simp_nac ?? 0);
  if (regime === 1 || regime === 2) return true;
  if (opSimp === 2 || opSimp === 3 || opSimp === 4) return true;
  return false;
}

/**
 * TCRegTrib no SEFIN (E0039): optante precisa opSimpNac=2 (MEI) ou 3 (ME/EPP) + regApTribSN.
 * Cadastro inconsistente (regime Simples + op_simp_nac=1) gerava DPS sem regApTribSN.
 */
function normalizeRegTribSefin(config) {
  const regime = Number(config?.regime_tributario ?? 0);
  let opSimpNac = Number(config?.op_simp_nac ?? 0);
  const optante = isOptanteSimplesNacional(config);
  if (!optante) {
    return {
      opSimpNac: opSimpNac === 2 || opSimpNac === 3 ? opSimpNac : 1,
      regApTribSN: null,
      regEspTrib: Number(config?.reg_esp_trib ?? 0),
    };
  }
  // 1=não optante e 4=pendente não bastam no ADN; ME/EPP (3) é o padrão Azoup.
  if (opSimpNac !== 2 && opSimpNac !== 3) {
    opSimpNac = regime === 2 ? 2 : 3;
  }
  const regAp = Number(config?.reg_ap_trib_sn ?? 1);
  return {
    opSimpNac,
    regApTribSN: Number.isFinite(regAp) && regAp >= 1 ? regAp : 1,
    regEspTrib: Number(config?.reg_esp_trib ?? 0),
  };
}

/**
 * @param {string|number} ibge
 * @param {number} [ambiente]
 * @param {{ forceNacional?: boolean, optanteSimples?: boolean, config?: object }} [opts]
 */
function resolveNfseGateway(ibge, ambiente = 1, opts = {}) {
  const cod = normalizeIbge(ibge);
  const forceNacional =
    opts.forceNacional === true ||
    opts.optanteSimples === true ||
    (opts.config != null && isOptanteSimplesNacional(opts.config));

  // Simples em Americana: SEFIN Emissor Nacional (sem URL municipal).
  // RN E0039: opSimpNac 2/3 + regApTribSN=1 + competência ≥ 11/2026.
  if (forceNacional && cod === '3501608') {
    return {
      mode: 'nacional',
      ibge: cod,
      nome: 'Americana/SP — SEFIN Emissor Nacional (Simples)',
      skipConvenioNacional: true,
      urlOverrides: null,
    };
  }

  const gw = GATEWAYS_BY_IBGE[cod];
  if (!gw) {
    return {
      mode: 'nacional',
      ibge: cod,
      nome: 'SEFIN Nacional',
      skipConvenioNacional: false,
      urlOverrides: null,
    };
  }
  if (gw.mode === 'paulistana' || gw.mode === 'abrasf') {
    const amb = Number(ambiente) === 1 ? 'P' : 'H';
    return {
      mode: gw.mode,
      ibge: cod,
      nome: gw.nome,
      skipConvenioNacional: true,
      urlOverrides: gw[amb] ?? gw.P ?? null,
    };
  }
  const amb = Number(ambiente) === 1 ? 'P' : 'H';
  return {
    mode: 'municipal',
    ibge: cod,
    nome: gw.nome,
    skipConvenioNacional: Boolean(gw.skipConvenioNacional),
    urlOverrides: gw[amb] ?? gw.H,
  };
}

/** Define NFSE_URL_OVERRIDES para o @nfewizard/shared (patch em postinstall). */
function applyNfseGatewayEnv(ibge, ambiente = 1, opts = {}) {
  const gateway = resolveNfseGateway(ibge, ambiente, opts);
  if (gateway.urlOverrides) {
    process.env.NFSE_URL_OVERRIDES = JSON.stringify(gateway.urlOverrides);
  } else {
    delete process.env.NFSE_URL_OVERRIDES;
  }
  return gateway;
}

function clearNfseGatewayEnv() {
  delete process.env.NFSE_URL_OVERRIDES;
}

module.exports = {
  GATEWAYS_BY_IBGE,
  resolveNfseGateway,
  applyNfseGatewayEnv,
  clearNfseGatewayEnv,
  normalizeIbge,
  isOptanteSimplesNacional,
  normalizeRegTribSefin,
};
