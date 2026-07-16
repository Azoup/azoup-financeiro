/**
 * Roteamento de emissão NFS-e por município (IBGE).
 * - 3550308 São Paulo capital → WebService Paulistana (SOAP)
 * - 3501608 Americana → API ADN municipal (Tiplan)
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
    nome: 'Americana/SP — emissor municipal ADN',
    mode: 'municipal',
    skipConvenioNacional: true,
    H: {
      NFSe_Autorizacao: 'https://americanahomologacao.nfe.com.br/api/adn/dps/recepcao',
      NFSe_Eventos: 'https://americanahomologacao.nfe.com.br/api/adn/dps/evento',
      NFSe_Consulta: 'https://americanahomologacao.nfe.com.br/api/adn/dps/recepcao',
      NFSe_ConsultaDPS: 'https://americanahomologacao.nfe.com.br/api/adn/dps/recepcao',
      NFSe_ChaveAcesso: 'https://americanahomologacao.nfe.com.br/api/adn/dps/chave-acesso',
      NFSe_Xml: 'https://americanahomologacao.nfe.com.br/api/adn/dps/xml',
    },
    P: {
      NFSe_Autorizacao: 'https://nfse.americana.sp.gov.br/api/adn/dps/recepcao',
      NFSe_Eventos: 'https://nfse.americana.sp.gov.br/api/adn/dps/evento',
      NFSe_Consulta: 'https://nfse.americana.sp.gov.br/api/adn/dps/recepcao',
      NFSe_ConsultaDPS: 'https://nfse.americana.sp.gov.br/api/adn/dps/recepcao',
      // Manual Tiplan 1.4: path de produção difere do de homologação.
      NFSe_ChaveAcesso: 'https://nfse.americana.sp.gov.br/api/adn/dps/recepcao/chave-acesso',
      NFSe_Xml: 'https://nfse.americana.sp.gov.br/api/adn/dps/xml',
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
  if (gw.mode === 'paulistana') {
    return {
      mode: 'paulistana',
      ibge: cod,
      nome: gw.nome,
      skipConvenioNacional: true,
      urlOverrides: null,
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
