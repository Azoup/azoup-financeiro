/**
 * NFS-e Americana/SP — WebService ABRASF 2.03 (TipLan), mesmo canal típico do Delphi.
 * Produção: https://nfse.americana.sp.gov.br/nfse/wsnacional2/nfse.asmx
 * Método: GerarNfse (1 RPS síncrono).
 * Fonte envelope: ACBr Tiplanv2.ini
 */
const fs = require('fs');
const https = require('https');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');

const NS_ABRASF = 'http://www.abrasf.org.br/nfse.xsd';
const NS_SOAP_OP = 'http://nfse.abrasf.org.br/';
const SOAP_ACTION_GERAR = 'http://nfse.abrasf.org.br/GerarNfse';
const SOAP_ACTION_CANCELAR = 'http://nfse.abrasf.org.br/CancelarNfse';

const WS_URL = {
  1: 'https://nfse.americana.sp.gov.br/nfse/wsnacional2/nfse.asmx',
  2: 'https://americanahomologacao.nfe.com.br/nfse/wsnacional2/nfse.asmx',
};

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return (Math.round(v * 100) / 100).toFixed(2);
}

function dateYmd(iso) {
  const d = new Date(iso ?? Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseCompetenciaIso(competencia, fallbackDate) {
  const raw = String(competencia ?? '').trim();
  const m1 = raw.match(/^(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[2]}-${m1[1]}-01`;
  const m2 = raw.match(/^(\d{4})-(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-01`;
  return dateYmd(fallbackDate);
}

/** cTribNac 010701 → ItemListaServico 01.07 */
function itemListaServico(cTribNac) {
  const d = onlyDigits(cTribNac).padStart(6, '0').slice(0, 6);
  return `${d.slice(0, 2)}.${d.slice(2, 4)}`;
}

function codigoCnae(config) {
  const c = onlyDigits(config.codigo_cnae);
  if (c.length >= 7) return c.slice(0, 7);
  // CNAE da Azoup no portal de Americana (desenvolvimento de software).
  return '6209100';
}

function loadPfx(certPath, senha) {
  const pfx = fs.readFileSync(certPath);
  const forgePfx = forge.util.createBuffer(pfx.toString('binary'));
  const parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forgePfx), senha);
  const keyBags = parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const certBags = parsed.getBags({ bagType: forge.pki.oids.certBag });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!keyBag?.key || !certBag?.cert) {
    throw new Error('Não foi possível ler chave/certificado do .pfx para ABRASF Americana.');
  }
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(certBag.cert),
  };
}

function signInfDeclaracao(xml, privateKeyPem, certificatePem) {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    getKeyInfoContent: SignedXml.getKeyInfoContent,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  // ABRASF: Signature é irmã de InfDeclaracaoPrestacaoServico (dentro de Rps).
  sig.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
      action: 'after',
    },
  });
  return sig.getSignedXml();
}

function buildCabecalho() {
  return (
    `<cabecalho xmlns="${NS_ABRASF}" versao="2.03">` +
    `<versaoDados>2.03</versaoDados>` +
    `</cabecalho>`
  );
}

function buildGerarNfseXml({
  nota,
  itens,
  perfil,
  cliente,
  config,
  aliquotaPct,
  valorIss,
}) {
  const cnpj = onlyDigits(perfil.documento);
  const im = onlyDigits(config.inscricao_municipal);
  const tomadorDoc = onlyDigits(cliente.cnpj) || onlyDigits(cliente.documento);
  const isCpf = tomadorDoc.length === 11;
  const serie = String(Number(String(nota.serie || config.serie || '1').replace(/\D/g, '') || '1'));
  const numero = String(Number(nota.numero));
  const dh = dateYmd(nota.data_emissao);
  const competencia = parseCompetenciaIso(nota.competencia, nota.data_emissao);
  const valor = money2(nota.valor_total);
  const itemLista = itemListaServico(config.codigo_tributacao_nacional);
  const tribMun = onlyDigits(config.codigo_tributacao_municipal).slice(0, 3) || '001';
  const cnae = codigoCnae(config);
  const ibge = onlyDigits(config.codigo_ibge_emitente).padStart(7, '0').slice(0, 7);
  const desc =
    itens[0]?.descricao ?? config.descricao_servico_padrao ?? 'Prestacao de servicos';
  const tomadorNome =
    cliente.nome_fantasia || cliente.nome_cliente || cliente.nome || 'Tomador';
  // ADN opSimpNac: 1=não optante → ABRASF OptanteSimplesNacional 2; demais → 1 (sim).
  const optante = Number(config.op_simp_nac ?? 3) === 1 ? '2' : '1';
  const idInf = `rps${serie}${numero}`;

  const endLog = escapeXml(cliente.logradouro || perfil.logradouro || 'Nao informado');
  const endNum = escapeXml(cliente.numero || perfil.numero || 'S/N');
  const endBai = escapeXml(cliente.bairro || perfil.bairro || 'Centro');
  const endCep = onlyDigits(cliente.cep || perfil.cep).padStart(8, '0').slice(0, 8);
  const endUf = escapeXml(String(cliente.estado || cliente.uf || perfil.uf || 'SP').slice(0, 2));

  return (
    `<GerarNfseEnvio xmlns="${NS_ABRASF}">` +
    `<Rps>` +
    `<InfDeclaracaoPrestacaoServico Id="${idInf}">` +
    `<Rps>` +
    `<IdentificacaoRps>` +
    `<Numero>${escapeXml(numero)}</Numero>` +
    `<Serie>${escapeXml(serie)}</Serie>` +
    `<Tipo>1</Tipo>` +
    `</IdentificacaoRps>` +
    `<DataEmissao>${dh}</DataEmissao>` +
    `<Status>1</Status>` +
    `</Rps>` +
    `<Competencia>${competencia}</Competencia>` +
    `<Servico>` +
    `<Valores>` +
    `<ValorServicos>${valor}</ValorServicos>` +
    `<ValorDeducoes>0.00</ValorDeducoes>` +
    `<ValorPis>0.00</ValorPis>` +
    `<ValorCofins>0.00</ValorCofins>` +
    `<ValorInss>0.00</ValorInss>` +
    `<ValorIr>0.00</ValorIr>` +
    `<ValorCsll>0.00</ValorCsll>` +
    `<OutrasRetencoes>0.00</OutrasRetencoes>` +
    `<ValorIss>${money2(valorIss)}</ValorIss>` +
    `<Aliquota>${money2(aliquotaPct)}</Aliquota>` +
    `<DescontoIncondicionado>0.00</DescontoIncondicionado>` +
    `<DescontoCondicionado>0.00</DescontoCondicionado>` +
    `</Valores>` +
    `<IssRetido>2</IssRetido>` +
    `<ItemListaServico>${escapeXml(itemLista)}</ItemListaServico>` +
    `<CodigoCnae>${escapeXml(cnae)}</CodigoCnae>` +
    `<CodigoTributacaoMunicipio>${escapeXml(tribMun)}</CodigoTributacaoMunicipio>` +
    `<Discriminacao>${escapeXml(desc)}</Discriminacao>` +
    `<CodigoMunicipio>${ibge}</CodigoMunicipio>` +
    `<ExigibilidadeISS>1</ExigibilidadeISS>` +
    `<MunicipioIncidencia>${ibge}</MunicipioIncidencia>` +
    `</Servico>` +
    `<Prestador>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `</Prestador>` +
    `<TomadorServico>` +
    `<IdentificacaoTomador>` +
    `<CpfCnpj>${isCpf ? `<Cpf>${tomadorDoc}</Cpf>` : `<Cnpj>${tomadorDoc}</Cnpj>`}</CpfCnpj>` +
    `</IdentificacaoTomador>` +
    `<RazaoSocial>${escapeXml(tomadorNome)}</RazaoSocial>` +
    `<Endereco>` +
    `<Endereco>${endLog}</Endereco>` +
    `<Numero>${endNum}</Numero>` +
    `<Bairro>${endBai}</Bairro>` +
    `<CodigoMunicipio>${ibge}</CodigoMunicipio>` +
    `<Uf>${endUf}</Uf>` +
    `<Cep>${endCep}</Cep>` +
    `</Endereco>` +
    `</TomadorServico>` +
    `<OptanteSimplesNacional>${optante}</OptanteSimplesNacional>` +
    `<IncentivoFiscal>2</IncentivoFiscal>` +
    `</InfDeclaracaoPrestacaoServico>` +
    `</Rps>` +
    `</GerarNfseEnvio>`
  );
}

function soapGerarNfse(cabXml, dadosXml) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="${NS_SOAP_OP}">` +
    `<soap:Body>` +
    `<nfse:GerarNfseRequest>` +
    `<nfseCabecMsg>${escapeXml(cabXml)}</nfseCabecMsg>` +
    `<nfseDadosMsg>${escapeXml(dadosXml)}</nfseDadosMsg>` +
    `</nfse:GerarNfseRequest>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

function soapCancelarNfse(cabXml, dadosXml) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="${NS_SOAP_OP}">` +
    `<soap:Body>` +
    `<nfse:CancelarNfseRequest>` +
    `<nfseCabecMsg>${escapeXml(cabXml)}</nfseCabecMsg>` +
    `<nfseDadosMsg>${escapeXml(dadosXml)}</nfseDadosMsg>` +
    `</nfse:CancelarNfseRequest>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

function httpsSoap({ url, body, pfx, passphrase, soapAction }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        port: 443,
        minVersion: 'TLSv1.2',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          SOAPAction: `"${soapAction}"`,
        },
        pfx,
        passphrase,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function decodeSoapInner(soapBody) {
  let s = soapBody
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return s;
}

function parseGerarResult(soapBody) {
  const inner = decodeSoapInner(soapBody);
  const mensagens = [
    ...inner.matchAll(
      /<Codigo>\s*([^<]+)\s*<\/Codigo>[\s\S]*?<Mensagem>\s*([^<]+)\s*<\/Mensagem>/gi,
    ),
  ].map((m) => `${m[1].trim()}: ${m[2].trim()}`);

  const numero =
    inner.match(/<Numero>\s*([^<]+)\s*<\/Numero>/i)?.[1]?.trim() ?? null;
  const codVerif =
    inner.match(/<CodigoVerificacao>\s*([^<]+)\s*<\/CodigoVerificacao>/i)?.[1]?.trim() ?? null;
  const chave =
    inner.match(/<ChaveAcesso>\s*([^<]+)\s*<\/ChaveAcesso>/i)?.[1]?.trim() ??
    inner.match(/<chNFSe>\s*([^<]+)\s*<\/chNFSe>/i)?.[1]?.trim() ??
    null;

  const hasNfse = /<CompNfse[\s>]/i.test(inner) || /<Nfse[\s>]/i.test(inner);
  const hasErroLista = /<ListaMensagemRetorno[\s>]/i.test(inner) && mensagens.length > 0;

  if (hasNfse && (codVerif || numero || chave)) {
    return {
      sucesso: true,
      erros: mensagens,
      numero,
      codigoVerificacao: codVerif,
      chaveAcesso: chave || codVerif || numero,
      xml: inner,
    };
  }

  return {
    sucesso: false,
    erros: mensagens.length ? mensagens : hasErroLista ? ['Rejeitada pela prefeitura (ABRASF).'] : [],
    numero: null,
    codigoVerificacao: null,
    chaveAcesso: null,
    xml: inner,
  };
}

/**
 * Emite NFS-e via GerarNfse ABRASF TipLan (produção por padrão).
 */
async function emitirNfseAbrasfAmericana({
  certPath,
  senha,
  nota,
  itens,
  perfil,
  cliente,
  config,
  ambiente = 1,
}) {
  const cnpj = onlyDigits(perfil.documento);
  if (cnpj.length !== 14) {
    throw new Error('Americana (ABRASF) exige CNPJ do prestador.');
  }
  const im = onlyDigits(config.inscricao_municipal);
  if (!im) {
    throw new Error('Informe a Inscrição Municipal de Americana (ex.: 69842).');
  }
  const tomadorDoc = onlyDigits(cliente.cnpj) || onlyDigits(cliente.documento);
  if (tomadorDoc.length !== 11 && tomadorDoc.length !== 14) {
    throw new Error('Cliente sem CPF/CNPJ válido.');
  }
  const valor = Number(nota.valor_total);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('Valor da nota inválido.');
  }

  const aliquotaPct = Number(config.trib_issqn ?? 1) === 1 ? 4 : 0;
  const valorIss = (valor * aliquotaPct) / 100;

  const { privateKeyPem, certificatePem } = loadPfx(certPath, senha);
  let dadosXml = buildGerarNfseXml({
    nota,
    itens,
    perfil,
    cliente,
    config,
    aliquotaPct,
    valorIss,
  });
  dadosXml = signInfDeclaracao(dadosXml, privateKeyPem, certificatePem);

  const cab = buildCabecalho();
  const soap = soapGerarNfse(cab, dadosXml);
  const url = WS_URL[Number(ambiente) === 2 ? 2 : 1];
  const pfxBuf = fs.readFileSync(certPath);

  console.info('[nfse] gateway ABRASF Americana', url, 'ItemListaServico', itemListaServico(config.codigo_tributacao_nacional));

  const httpRes = await httpsSoap({
    url,
    body: soap,
    pfx: pfxBuf,
    passphrase: senha,
    soapAction: SOAP_ACTION_GERAR,
  });

  if (httpRes.statusCode === 403) {
    return {
      success: false,
      status: 'ERR',
      message:
        'ABRASF Americana HTTP 403. Certifique-se de que o A1 está válido e há Autorização para Emissão no portal.',
    };
  }
  if (httpRes.statusCode >= 400) {
    const plain = httpRes.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    return {
      success: false,
      status: 'ERR',
      message: `ABRASF Americana HTTP ${httpRes.statusCode}: ${plain || 'falha no WebService'}`,
      xml_autorizado: httpRes.body?.slice?.(0, 4000) || null,
    };
  }

  const parsed = parseGerarResult(httpRes.body);
  if (!parsed.sucesso) {
    const msg = parsed.erros.join(' | ') || 'Rejeitada pelo WebService ABRASF de Americana.';
    return { success: false, status: 'ERR', message: msg, xml_autorizado: parsed.xml };
  }

  return {
    success: true,
    status: '100',
    chave_acesso: parsed.chaveAcesso,
    protocolo_autorizacao: parsed.numero,
    codigo_verificacao: parsed.codigoVerificacao,
    xml_autorizado: parsed.xml,
    danfe_url: null,
    danfe_storage_path: null,
    message: 'NFS-e autorizada via WebService ABRASF (Americana).',
  };
}

async function cancelarNfseAbrasfAmericana({
  certPath,
  senha,
  nota,
  perfil,
  config,
  justificativa,
  ambiente = 1,
}) {
  const xJust = String(justificativa ?? '').trim();
  if (xJust.length < 15) {
    throw new Error('A justificativa de cancelamento deve ter no mínimo 15 caracteres.');
  }
  const cnpj = onlyDigits(perfil.documento);
  const im = onlyDigits(config.inscricao_municipal);
  const numero = onlyDigits(nota.protocolo_autorizacao) || onlyDigits(nota.chave_acesso);
  const codVerif = String(nota.codigo_verificacao || nota.chave_acesso || '').trim();
  if (!numero && !codVerif) {
    throw new Error('Nota sem número/código de verificação para cancelar no ABRASF.');
  }

  const { privateKeyPem, certificatePem } = loadPfx(certPath, senha);
  const idPed = `cancel${Date.now()}`;
  let ped =
    `<CancelarNfseEnvio xmlns="${NS_ABRASF}">` +
    `<Pedido>` +
    `<InfPedidoCancelamento Id="${idPed}">` +
    `<IdentificacaoNfse>` +
    `<Numero>${escapeXml(numero || '0')}</Numero>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `<CodigoMunicipio>3501608</CodigoMunicipio>` +
    (codVerif ? `<CodigoVerificacao>${escapeXml(codVerif)}</CodigoVerificacao>` : '') +
    `</IdentificacaoNfse>` +
    `<CodigoCancelamento>1</CodigoCancelamento>` +
    `</InfPedidoCancelamento>` +
    `</Pedido>` +
    `</CancelarNfseEnvio>`;

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    getKeyInfoContent: SignedXml.getKeyInfoContent,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='InfPedidoCancelamento']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(ped, {
    location: { reference: "//*[local-name(.)='Pedido']", action: 'append' },
  });
  ped = sig.getSignedXml();

  const soap = soapCancelarNfse(buildCabecalho(), ped);
  const httpRes = await httpsSoap({
    url: WS_URL[Number(ambiente) === 2 ? 2 : 1],
    body: soap,
    pfx: fs.readFileSync(certPath),
    passphrase: senha,
    soapAction: SOAP_ACTION_CANCELAR,
  });

  if (httpRes.statusCode >= 400) {
    return {
      success: false,
      status: 'ERR',
      message: `Cancelamento ABRASF HTTP ${httpRes.statusCode}`,
    };
  }

  const inner = decodeSoapInner(httpRes.body);
  const mensagens = [
    ...inner.matchAll(
      /<Codigo>\s*([^<]+)\s*<\/Codigo>[\s\S]*?<Mensagem>\s*([^<]+)\s*<\/Mensagem>/gi,
    ),
  ].map((m) => `${m[1].trim()}: ${m[2].trim()}`);

  const ok =
    /<Confirmacao[\s>]/i.test(inner) ||
    /DataHora[\s>]/i.test(inner) ||
    (!mensagens.length && /CancelarNfseResposta/i.test(inner));

  if (!ok && mensagens.length) {
    return { success: false, status: 'ERR', message: mensagens.join(' | ') };
  }

  return {
    success: true,
    status: '100',
    message: mensagens.join(' | ') || 'NFS-e cancelada (ABRASF Americana).',
  };
}

module.exports = {
  emitirNfseAbrasfAmericana,
  cancelarNfseAbrasfAmericana,
  itemListaServico,
  codigoCnae,
};
