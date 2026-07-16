/**
 * Roteamento de emissão NFS-e por município (IBGE).
 * - 3550308 São Paulo capital → WebService Paulistana (SOAP)
 * - 3501608 Americana → WebService ABRASF 2.03 TipLan (mesmo canal típico do Delphi)
 * - demais → SEFIN Nacional (ADN)
 */
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
    // Mantido para cancelamento/consulta ADN se necessário.
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
  },
};

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function normalizeIbge(ibge) {
  return onlyDigits(ibge).padStart(7, '0').slice(0, 7);
}

function resolveNfseGateway(ibge, ambiente = 1) {
  const cod = normalizeIbge(ibge);
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
function applyNfseGatewayEnv(ibge, ambiente = 1) {
  const gateway = resolveNfseGateway(ibge, ambiente);
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
};
