/**
 * NFS-e São Paulo capital — WebService Paulistana (LoteNFe).
 * Homologação: TesteEnvioLoteRPS (valida sem gerar NFS-e).
 * Produção: EnvioRPS.
 * Endpoint: https://nfews.prefeitura.sp.gov.br/lotenfe.asmx (SOAP 1.2 + mTLS A1).
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');

const WS_URL = 'https://nfews.prefeitura.sp.gov.br/lotenfe.asmx';
const NS = 'http://www.prefeitura.sp.gov.br/nfe';

/** soapAction do WSDL (não é o nome do método). Fonte: ACBr SP.ini / WSDL Paulistana. */
const SOAP_ACTIONS = {
  TesteEnvioLoteRPS: `${NS}/ws/testeenvio`,
  EnvioLoteRPS: `${NS}/ws/envioLoteRPS`,
  EnvioRPS: `${NS}/ws/envioRPS`,
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

function moneyPlain(n) {
  const v = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(v)) return '0';
  return String(v);
}

function moneyCents15(n) {
  const cents = Math.round(Number(n) * 100);
  return String(Number.isFinite(cents) ? Math.max(0, cents) : 0).padStart(15, '0');
}

function padLeft(s, len, ch = '0') {
  return String(s ?? '').padStart(len, ch).slice(-len);
}

function padRight(s, len, ch = ' ') {
  const t = String(s ?? '');
  return (t + ch.repeat(len)).slice(0, len);
}

function dateYmd(iso) {
  const d = new Date(iso ?? Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateYmdCompact(iso) {
  return dateYmd(iso).replace(/-/g, '');
}

/** Código de serviço Paulistana: 4–5 dígitos. */
function codigoServicoSp(config) {
  const mun = onlyDigits(config.codigo_tributacao_municipal);
  if (mun.length >= 4) return mun.slice(0, 5);
  // Fallback: últimos 5 do cTribNac (ex.: 010701 → 10701) — confirme na lista da prefeitura.
  const nac = onlyDigits(config.codigo_tributacao_nacional);
  if (nac.length >= 5) return nac.slice(-5);
  return padLeft(mun || nac || '0', 5);
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
    throw new Error('Não foi possível ler chave/certificado do .pfx para a Paulistana.');
  }
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(certBag.cert),
    privateKey: keyBag.key,
  };
}

/**
 * Assinatura do RPS (versão 1) — string concatenada + RSA-SHA1 → Base64.
 * Sem intermediário.
 */
function assinarRpsV1({
  im,
  serie,
  numero,
  dataEmissao,
  tributacao,
  status,
  issRetido,
  valorServicos,
  valorDeducoes,
  codigoServico,
  tomadorDoc,
}) {
  const indToma = tomadorDoc.length === 11 ? '1' : tomadorDoc.length === 14 ? '2' : '3';
  const docToma = padLeft(tomadorDoc || '0', 14);
  const cadeia =
    padLeft(onlyDigits(im), 8) +
    padRight(String(serie || '1'), 5) +
    padLeft(String(numero), 12) +
    dateYmdCompact(dataEmissao) +
    String(tributacao || 'T').slice(0, 1) +
    String(status || 'N').slice(0, 1) +
    (issRetido ? 'S' : 'N') +
    moneyCents15(valorServicos) +
    moneyCents15(valorDeducoes) +
    padLeft(onlyDigits(codigoServico), 5) +
    indToma +
    docToma;

  return { cadeia, assinaturaFn: null, cadeiaRaw: cadeia };
}

function signRpsCadeia(cadeia, privateKeyPem) {
  const sign = crypto.createSign('RSA-SHA1');
  sign.update(cadeia, 'ascii');
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
}

function buildPedidoEnvioRpsXml({
  cnpjRemetente,
  im,
  serie,
  numero,
  dataEmissao,
  valor,
  codigoServico,
  aliquota,
  discriminacao,
  tomadorDoc,
  tomadorNome,
  tomadorEnd,
  assinaturaRps,
}) {
  const isCpf = tomadorDoc.length === 11;
  const end = tomadorEnd || {};
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<PedidoEnvioRPS xmlns="${NS}">` +
    `<Cabecalho Versao="1" xmlns="">` +
    `<CPFCNPJRemetente><CNPJ>${escapeXml(cnpjRemetente)}</CNPJ></CPFCNPJRemetente>` +
    `</Cabecalho>` +
    `<RPS xmlns="">` +
    `<Assinatura>${escapeXml(assinaturaRps)}</Assinatura>` +
    `<ChaveRPS>` +
    `<InscricaoPrestador>${escapeXml(padLeft(onlyDigits(im), 8))}</InscricaoPrestador>` +
    `<SerieRPS>${escapeXml(String(serie || '1').slice(0, 5))}</SerieRPS>` +
    `<NumeroRPS>${escapeXml(String(numero))}</NumeroRPS>` +
    `</ChaveRPS>` +
    `<TipoRPS>RPS</TipoRPS>` +
    `<DataEmissao>${escapeXml(dateYmd(dataEmissao))}</DataEmissao>` +
    `<StatusRPS>N</StatusRPS>` +
    `<TributacaoRPS>T</TributacaoRPS>` +
    `<ValorServicos>${escapeXml(moneyPlain(valor))}</ValorServicos>` +
    `<ValorDeducoes>0</ValorDeducoes>` +
    `<CodigoServico>${escapeXml(padLeft(onlyDigits(codigoServico), 5))}</CodigoServico>` +
    `<AliquotaServicos>${escapeXml(moneyPlain(aliquota))}</AliquotaServicos>` +
    `<ISSRetido>false</ISSRetido>` +
    `<CPFCNPJTomador>${isCpf ? `<CPF>${escapeXml(tomadorDoc)}</CPF>` : `<CNPJ>${escapeXml(tomadorDoc)}</CNPJ>`}</CPFCNPJTomador>` +
    `<RazaoSocialTomador>${escapeXml(tomadorNome)}</RazaoSocialTomador>` +
    `<EnderecoTomador>` +
    `<TipoLogradouro>Rua</TipoLogradouro>` +
    `<Logradouro>${escapeXml(end.logradouro || 'Nao informado')}</Logradouro>` +
    `<NumeroEndereco>${escapeXml(end.numero || 'S/N')}</NumeroEndereco>` +
    `<Bairro>${escapeXml(end.bairro || 'Centro')}</Bairro>` +
    `<Cidade>${escapeXml(end.cidadeIbge || '3550308')}</Cidade>` +
    `<UF>${escapeXml(end.uf || 'SP')}</UF>` +
    `<CEP>${escapeXml(padLeft(onlyDigits(end.cep), 8))}</CEP>` +
    `</EnderecoTomador>` +
    `<Discriminacao>${escapeXml(discriminacao)}</Discriminacao>` +
    `</RPS>` +
    `</PedidoEnvioRPS>`
  );
}

function buildPedidoEnvioLoteRpsXml(args) {
  const cnpj = args.cnpjRemetente;
  const valor = moneyPlain(args.valor);
  const dt = dateYmd(args.dataEmissao);
  const rpsInner = buildPedidoEnvioRpsXml(args)
    .replace(/^<\?xml[^?]*\?>/, '')
    .replace(`<PedidoEnvioRPS xmlns="${NS}">`, '')
    .replace('</PedidoEnvioRPS>', '')
    .replace(/<Cabecalho[\s\S]*?<\/Cabecalho>/, '');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<PedidoEnvioLoteRPS xmlns="${NS}">` +
    `<Cabecalho Versao="1" xmlns="">` +
    `<CPFCNPJRemetente><CNPJ>${escapeXml(cnpj)}</CNPJ></CPFCNPJRemetente>` +
    `<transacao>true</transacao>` +
    `<dtInicio>${escapeXml(dt)}</dtInicio>` +
    `<dtFim>${escapeXml(dt)}</dtFim>` +
    `<QtdeRPS>1</QtdeRPS>` +
    `<ValorTotalServicos>${escapeXml(valor)}</ValorTotalServicos>` +
    `<ValorTotalDeducoes>0</ValorTotalDeducoes>` +
    `</Cabecalho>` +
    rpsInner +
    `</PedidoEnvioLoteRPS>`
  );
}

function signXmlDocument(xml, privateKeyPem, certificatePem) {
  // Remover declaração XML — a assinatura é só do pedido (manual § FAQ).
  const xmlSemDecl = String(xml).replace(/^<\?xml[^?]*\?>\s*/i, '');
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    // Manual: Enveloped + C14N. KeyInfo com X509 é o default do xml-crypto 6.x.
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    getKeyInfoContent: SignedXml.getKeyInfoContent,
  });
  // isEmptyUri: true → Reference URI="" (exigido pela Paulistana).
  // Sem isso o xml-crypto injeta Id="_0" no root e quebra o XSD (HTTP 500).
  sig.addReference({
    xpath: '/*',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: '',
    isEmptyUri: true,
  });
  sig.computeSignature(xmlSemDecl, {
    location: { reference: '/*', action: 'append' },
  });
  return sig.getSignedXml();
}

/** SOAP 1.2 — exigido pelo endpoint nfews.prefeitura.sp.gov.br (manual). */
function soapEnvelope(method, mensagemXml) {
  // Escapar caracteres especiais (alternativa oficial à CDATA; gem nfe-paulistana).
  const escaped = escapeXml(mensagemXml);
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<${method} xmlns="${NS}">` +
    `<VersaoSchema>1</VersaoSchema>` +
    `<MensagemXML>${escaped}</MensagemXML>` +
    `</${method}>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function httpsRequest({ url, body, pfx, passphrase, soapAction }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const action = soapAction; // URI completa do WSDL, ex.: .../nfe/ws/testeenvio
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        port: 443,
        minVersion: 'TLSv1.2',
        headers: {
          // SOAP 1.2: action no Content-Type (URI do WSDL, não o nome do método).
          'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
          'Content-Length': Buffer.byteLength(body),
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

function extractHttpErrorDetail(soapBody) {
  if (!soapBody) return '';
  const fault =
    soapBody.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1] ||
    soapBody.match(/<Reason>[\s\S]*?<Text[^>]*>([\s\S]*?)<\/Text>/i)?.[1] ||
    soapBody.match(/<Title>([\s\S]*?)<\/Title>/i)?.[1] ||
    soapBody.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1];
  if (fault) {
    return fault
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
  }
  const plain = soapBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 280);
}

function parseSoapResult(soapBody, method) {
  const resultTag = `${method}Result`;
  const m = soapBody.match(new RegExp(`<${resultTag}[^>]*>([\\s\\S]*?)</${resultTag}>`, 'i'));
  let inner = m ? m[1] : soapBody;
  inner = inner
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  const sucesso = /<Sucesso>\s*true\s*<\/Sucesso>/i.test(inner);
  const erros = [...inner.matchAll(/<Codigo>\s*([^<]+)\s*<\/Codigo>[\s\S]*?<Descricao>\s*([^<]+)\s*<\/Descricao>/gi)].map(
    (x) => `${x[1].trim()}: ${x[2].trim()}`,
  );
  const chaveNfe = inner.match(/<CodigoVerificacao>\s*([^<]+)\s*<\/CodigoVerificacao>/i)?.[1]?.trim() ?? null;
  const numeroNfe = inner.match(/<NumeroNFe>\s*([^<]+)\s*<\/NumeroNFe>/i)?.[1]?.trim() ?? null;

  return { sucesso, erros, chaveNfe, numeroNfe, xml: inner };
}

/**
 * Emite (ou testa) NFS-e na Paulistana.
 * @param {object} opts
 * @param {2|1} opts.ambiente — 2 = TesteEnvioLoteRPS (homologação), 1 = EnvioRPS
 */
async function emitirNfsePaulistana({
  certPath,
  senha,
  nota,
  itens,
  perfil,
  cliente,
  config,
  ambiente = 2,
}) {
  const cnpj = onlyDigits(perfil.documento);
  if (cnpj.length !== 14) {
    throw new Error('São Paulo (Paulistana) exige CNPJ do prestador (14 dígitos).');
  }
  const im = onlyDigits(config.inscricao_municipal);
  if (im.length < 1) {
    throw new Error(
      'Informe a Inscrição Municipal (CCM) de São Paulo em Configurações › NFS-e (obrigatória na Paulistana).',
    );
  }
  if (im.length > 12) {
    throw new Error(
      'CCM de São Paulo inválido (máx. 12 dígitos). Confira a Inscrição Municipal no portal da Paulistana.',
    );
  }

  const tomadorDoc = onlyDigits(cliente.cnpj) || onlyDigits(cliente.documento);
  if (tomadorDoc.length !== 11 && tomadorDoc.length !== 14) {
    throw new Error('Cliente sem CPF/CNPJ válido.');
  }

  const valor = Number(nota.valor_total);
  const codigoServico = codigoServicoSp(config);
  const serie = String(nota.serie || config.serie || '1').slice(0, 5);
  const numero = Number(nota.numero);
  const dataEmissao = nota.data_emissao;
  const discriminacao =
    Number(ambiente) === 2
      ? `TESTE HOMOLOGACAO PAULISTANA - SEM VALOR FISCAL - ${itens[0]?.descricao ?? config.descricao_servico_padrao}`
      : itens[0]?.descricao ?? config.descricao_servico_padrao;

  const { privateKeyPem, certificatePem } = loadPfx(certPath, senha);
  const { cadeiaRaw } = assinarRpsV1({
    im,
    serie,
    numero,
    dataEmissao,
    tributacao: 'T',
    status: 'N',
    issRetido: false,
    valorServicos: valor,
    valorDeducoes: 0,
    codigoServico,
    tomadorDoc,
  });
  const assinaturaRps = signRpsCadeia(cadeiaRaw, privateKeyPem);

  const args = {
    cnpjRemetente: cnpj,
    im,
    serie,
    numero,
    dataEmissao,
    valor,
    codigoServico,
    aliquota: 0.05,
    discriminacao,
    tomadorDoc,
    tomadorNome:
      Number(ambiente) === 2
        ? 'TESTE HOMOLOGACAO PAULISTANA - SEM VALOR FISCAL'
        : cliente.nome_fantasia || cliente.nome_cliente || cliente.nome || 'Tomador',
    tomadorEnd: {
      logradouro: cliente.logradouro || perfil.logradouro,
      numero: cliente.numero || perfil.numero,
      bairro: cliente.bairro || perfil.bairro,
      cep: cliente.cep || perfil.cep,
      uf: cliente.estado || cliente.uf || perfil.uf || 'SP',
      cidadeIbge: '3550308',
    },
    assinaturaRps,
  };

  const isTeste = Number(ambiente) !== 1;
  const method = isTeste ? 'TesteEnvioLoteRPS' : 'EnvioRPS';
  const soapAction = SOAP_ACTIONS[method];
  if (!soapAction) {
    throw new Error(`SOAPAction não mapeado para o método Paulistana: ${method}`);
  }
  let xmlPedido = isTeste ? buildPedidoEnvioLoteRpsXml(args) : buildPedidoEnvioRpsXml(args);
  xmlPedido = signXmlDocument(xmlPedido, privateKeyPem, certificatePem);

  const soap = soapEnvelope(method, xmlPedido);
  const pfxBuf = fs.readFileSync(certPath);
  const httpRes = await httpsRequest({
    url: WS_URL,
    body: soap,
    pfx: pfxBuf,
    passphrase: senha,
    soapAction,
  });

  if (httpRes.statusCode === 403) {
    return {
      success: false,
      status: 'ERR',
      message:
        'Paulistana HTTP 403 (acesso negado). O certificado A1 precisa estar válido e vinculado ao CNPJ/CCM em São Paulo (mTLS).',
    };
  }

  if (httpRes.statusCode >= 400) {
    const detail = extractHttpErrorDetail(httpRes.body);
    return {
      success: false,
      status: 'ERR',
      message: detail
        ? `Paulistana HTTP ${httpRes.statusCode}: ${detail}`
        : `Paulistana HTTP ${httpRes.statusCode}. Verifique certificado A1, CCM de São Paulo e código de serviço (4–5 dígitos).`,
      xml_autorizado: httpRes.body?.slice?.(0, 4000) || null,
    };
  }

  const parsed = parseSoapResult(httpRes.body, method);
  if (!parsed.sucesso) {
    const msg = parsed.erros.join(' | ') || 'Rejeitada pela Paulistana (São Paulo).';
    return { success: false, status: 'ERR', message: msg, xml_autorizado: parsed.xml };
  }

  if (isTeste) {
    return {
      success: true,
      status: '100',
      chave_acesso: parsed.chaveNfe || `TESTE-SP-${serie}-${numero}`,
      protocolo_autorizacao: null,
      codigo_verificacao: parsed.chaveNfe,
      xml_autorizado: parsed.xml,
      danfe_url: null,
      danfe_storage_path: null,
      message:
        'RPS validado no TesteEnvioLoteRPS da Paulistana (São Paulo). Em homologação a prefeitura não gera NFS-e real.',
    };
  }

  return {
    success: true,
    status: '100',
    chave_acesso: parsed.chaveNfe || parsed.numeroNfe,
    protocolo_autorizacao: parsed.numeroNfe,
    codigo_verificacao: parsed.chaveNfe,
    xml_autorizado: parsed.xml,
    danfe_url: null,
    danfe_storage_path: null,
    message: 'NFS-e autorizada pela Paulistana (São Paulo).',
  };
}

module.exports = { emitirNfsePaulistana, codigoServicoSp };
