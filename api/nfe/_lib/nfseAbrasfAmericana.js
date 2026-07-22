/**
 * NFS-e Americana/SP — WebService ABRASF 2.03 TipLan.
 * Layout alinhado ao XML que o Delphi emite com sucesso:
 * EnviarLoteRpsSincronoEnvio + assinatura do LoteRps (C14N inclusivo).
 * Produção: https://nfse.americana.sp.gov.br/nfse/wsnacional2/nfse.asmx
 */
const fs = require('fs');
const https = require('https');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');

const NS_ABRASF = 'http://www.abrasf.org.br/nfse.xsd';
const NS_SOAP_OP = 'http://nfse.abrasf.org.br/';
const SOAP_ACTION_LOTE_SYNC = 'http://nfse.abrasf.org.br/RecepcionarLoteRpsSincrono';
const SOAP_ACTION_CANCELAR = 'http://nfse.abrasf.org.br/CancelarNfse';
const C14N_INCLUSIVE = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

const WS_URL = {
  1: 'https://nfse.americana.sp.gov.br/nfse/wsnacional2/nfse.asmx',
  2: 'https://americanahomologacao.nfe.com.br/nfse/wsnacional2/nfse.asmx',
};

/** NBS usado pela Azoup no Delphi (suporte/manutenção em TI). */
const NBS_DEFAULT_AZOUP = '115013000';

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
  const raw = String(iso ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(iso ?? Date.now());
  // Evita deslocamento UTC: monta Y-M-D com componentes locais.
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
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
  const raw = String(cTribNac ?? '').trim();
  const dotted = raw.match(/^(\d{1,2})\.(\d{2})$/);
  if (dotted) return `${dotted[1].padStart(2, '0')}.${dotted[2]}`;
  const d = onlyDigits(raw).padStart(6, '0').slice(0, 6);
  return `${d.slice(0, 2)}.${d.slice(2, 4)}`;
}

/**
 * Código de tributação municipal TipLan: formato XX.XX (mesmo do ItemListaServico).
 * Config ADN antiga "001" → converte para 01.07 via cTribNac.
 */
function codigoTributacaoMunicipioAbrasf(config) {
  const raw = String(config.codigo_tributacao_municipal ?? '').trim();
  const dotted = raw.match(/^(\d{1,2})\.(\d{2})$/);
  if (dotted) return `${dotted[1].padStart(2, '0')}.${dotted[2]}`;

  const mun = onlyDigits(raw);
  if (mun.length >= 4) {
    return `${mun.slice(0, 2)}.${mun.slice(2, 4)}`;
  }
  return itemListaServico(config.codigo_tributacao_nacional);
}

function codigoCnae(config) {
  const c = onlyDigits(config.codigo_cnae);
  if (c.length >= 7) return c.slice(0, 7);
  return '6209100';
}

function codigoNbs(config) {
  const nbs = onlyDigits(config.codigo_nbs).slice(0, 9);
  if (nbs.length === 9 && nbs !== '106043000') return nbs;
  // Azoup Delphi usa 115013000; 106043000 era default ADN genérico.
  return NBS_DEFAULT_AZOUP;
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

/** Assina LoteRps (como o Delphi) com C14N inclusivo. */
function signLoteRps(xml, privateKeyPem, certificatePem) {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: C14N_INCLUSIVE,
    getKeyInfoContent: SignedXml.getKeyInfoContent,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='LoteRps']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      C14N_INCLUSIVE,
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='LoteRps']",
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

/**
 * Monta EnviarLoteRpsSincronoEnvio idêntico ao layout Delphi que autoriza.
 */
function buildEnviarLoteRpsSincronoXml({
  nota,
  itens,
  perfil,
  cliente,
  config,
}) {
  const cnpj = onlyDigits(perfil.documento);
  const im = onlyDigits(config.inscricao_municipal);
  const tomadorDoc = onlyDigits(cliente.cnpj) || onlyDigits(cliente.documento);
  const isCpf = tomadorDoc.length === 11;
  const serie = String(Number(String(nota.serie || config.serie || '1').replace(/\D/g, '') || '1'));
  const numero = String(Number(nota.numero));
  // TipLan: NumeroLote é único por contribuinte e independente do nº do RPS (Delphi usa sequência própria).
  const numeroLote = String(Date.now()).slice(-12);
  const dh = dateYmd(nota.data_emissao);
  // Delphi usa a data de emissão também em Competencia (não o 1º do mês).
  const competencia = dh;
  const valorNum = Number(nota.valor_total);
  const valor = money2(valorNum);
  const itemLista = itemListaServico(config.codigo_tributacao_nacional);
  const tribMun = codigoTributacaoMunicipioAbrasf(config);
  const cnae = codigoCnae(config);
  const nbs = codigoNbs(config);
  const ibge = onlyDigits(config.codigo_ibge_emitente).padStart(7, '0').slice(0, 7);
  const desc =
    itens[0]?.descricao ?? config.descricao_servico_padrao ?? 'Prestacao de servicos';
  const tomadorNome =
    cliente.nome_fantasia || cliente.nome_cliente || cliente.nome || 'Tomador';
  // ADN: 1=não optante → ABRASF 2; demais (ME/EPP) → 1 (sim), igual ao Delphi.
  const optante = Number(config.op_simp_nac ?? 3) === 1 ? '2' : '1';
  // ABRASF: IssRetido 1=Sim, 2=Não. tp_ret_issqn: 1=não retido, 2/3=retido.
  const issRetido = Number(config.tp_ret_issqn ?? 1) === 1 ? '2' : '1';
  const situacaoPisCofins = String(config.situacao_pis_cofins ?? '00')
    .replace(/\D/g, '')
    .padStart(2, '0')
    .slice(0, 2);
  // TipLan XSD (reforma 2026): IBSCBS obrigatório em Servico (IndOp / CST / cClassTrib).
  const opDigits = onlyDigits(config.ind_op ?? config.codigo_operacao_ibscbs);
  const operacao = opDigits ? opDigits.slice(-6).padStart(6, '0') : '100501';
  const sitDigits = onlyDigits(config.cst_ibs_cbs ?? config.situacao_tributaria_ibscbs);
  const sitTrib = sitDigits ? sitDigits.padStart(3, '0').slice(0, 3) : '000';
  const classTribRaw = onlyDigits(
    config.c_class_trib ?? config.classificacao_tributaria_ibscbs,
  );
  const classTrib =
    classTribRaw.length === 6
      ? classTribRaw
      : `${sitTrib}${(classTribRaw || '001').padStart(3, '0').slice(0, 3)}`;
  const idLote = `Lote_${numeroLote}`;
  const idDec = `Dec_${numero}`;

  const endLog = escapeXml(cliente.logradouro || perfil.logradouro || 'Nao informado');
  const endNum = escapeXml(cliente.numero || perfil.numero || 'S/N');
  const endComp = String(cliente.complemento ?? '').trim();
  const endBai = escapeXml(cliente.bairro || perfil.bairro || 'Centro');
  const endCep = onlyDigits(cliente.cep || perfil.cep).padStart(8, '0').slice(0, 8);
  const endUf = escapeXml(String(cliente.estado || cliente.uf || perfil.uf || 'SP').slice(0, 2));
  const email = String(cliente.email ?? '').trim();

  return (
    `<EnviarLoteRpsSincronoEnvio xmlns="${NS_ABRASF}">` +
    `<LoteRps Id="${idLote}" versao="2.03">` +
    `<NumeroLote>${escapeXml(numeroLote)}</NumeroLote>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `<QuantidadeRps>1</QuantidadeRps>` +
    `<ListaRps>` +
    `<Rps>` +
    `<InfDeclaracaoPrestacaoServico xmlns="${NS_ABRASF}" Id="${idDec}">` +
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
    `<SituacaoTributariaPISCOFINS>${escapeXml(situacaoPisCofins)}</SituacaoTributariaPISCOFINS>` +
    `</Valores>` +
    `<IssRetido>${issRetido}</IssRetido>` +
    `<ItemListaServico>${escapeXml(itemLista)}</ItemListaServico>` +
    `<CodigoCnae>${escapeXml(cnae)}</CodigoCnae>` +
    `<CodigoTributacaoMunicipio>${escapeXml(tribMun)}</CodigoTributacaoMunicipio>` +
    `<CodigoNbs>${escapeXml(nbs)}</CodigoNbs>` +
    `<Discriminacao>${escapeXml(desc)}</Discriminacao>` +
    `<CodigoMunicipio>${ibge}</CodigoMunicipio>` +
    `<ExigibilidadeISS>1</ExigibilidadeISS>` +
    `<MunicipioIncidencia>${ibge}</MunicipioIncidencia>` +
    `<IBSCBS>` +
    `<OperacaoUsoConsumoPessoal>0</OperacaoUsoConsumoPessoal>` +
    `<Operacao>${escapeXml(operacao)}</Operacao>` +
    `<ValoresTributos>` +
    `<SituacaoTributaria>${escapeXml(sitTrib)}</SituacaoTributaria>` +
    `<ClassificacaoTributaria>${escapeXml(classTrib)}</ClassificacaoTributaria>` +
    `</ValoresTributos>` +
    `</IBSCBS>` +
    `</Servico>` +
    `<Prestador>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    `</Prestador>` +
    `<Tomador>` +
    `<IdentificacaoTomador>` +
    `<CpfCnpj>${isCpf ? `<Cpf>${tomadorDoc}</Cpf>` : `<Cnpj>${tomadorDoc}</Cnpj>`}</CpfCnpj>` +
    `</IdentificacaoTomador>` +
    `<RazaoSocial>${escapeXml(tomadorNome)}</RazaoSocial>` +
    `<Endereco>` +
    `<Endereco>${endLog}</Endereco>` +
    `<Numero>${endNum}</Numero>` +
    (endComp ? `<Complemento>${escapeXml(endComp)}</Complemento>` : '') +
    `<Bairro>${endBai}</Bairro>` +
    `<CodigoMunicipio>${ibge}</CodigoMunicipio>` +
    `<Uf>${endUf}</Uf>` +
    `<Cep>${endCep}</Cep>` +
    `</Endereco>` +
    (email ? `<Contato><Email>${escapeXml(email)}</Email></Contato>` : '') +
    `</Tomador>` +
    `<OptanteSimplesNacional>${optante}</OptanteSimplesNacional>` +
    `<IncentivoFiscal>2</IncentivoFiscal>` +
    `</InfDeclaracaoPrestacaoServico>` +
    `</Rps>` +
    `</ListaRps>` +
    `</LoteRps>` +
    `</EnviarLoteRpsSincronoEnvio>`
  );
}

function soapRecepcionarLoteSincrono(cabXml, dadosXml) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="${NS_SOAP_OP}">` +
    `<soap:Body>` +
    `<nfse:RecepcionarLoteRpsSincronoRequest>` +
    `<nfseCabecMsg>${escapeXml(cabXml)}</nfseCabecMsg>` +
    `<nfseDadosMsg>${escapeXml(dadosXml)}</nfseDadosMsg>` +
    `</nfse:RecepcionarLoteRpsSincronoRequest>` +
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
  return soapBody
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function parseLoteResult(soapBody) {
  const inner = decodeSoapInner(soapBody);
  const mensagens = [
    ...inner.matchAll(
      /<Codigo>\s*([^<]+)\s*<\/Codigo>[\s\S]*?<Mensagem>\s*([^<]+)\s*<\/Mensagem>/gi,
    ),
  ].map((m) => `${m[1].trim()}: ${m[2].trim()}`);

  // TipLan: A* = alerta (ex. A14); E*/X* = erro que impede autorização.
  const erros = mensagens.filter((m) => !/^A\d+/i.test(m));
  const alertas = mensagens.filter((m) => /^A\d+/i.test(m));

  // Preferir Numero dentro de InfNfse (número da NFS-e), não o do RPS.
  const numero =
    inner.match(/<InfNfse[\s\S]*?<Numero>\s*([^<]+)\s*<\/Numero>/i)?.[1]?.trim() ?? null;
  const codVerif =
    inner.match(/<CodigoVerificacao>\s*([^<]+)\s*<\/CodigoVerificacao>/i)?.[1]?.trim() ?? null;
  const protocolo =
    inner.match(/<Protocolo>\s*([^<]+)\s*<\/Protocolo>/i)?.[1]?.trim() ?? null;
  const chave =
    inner.match(/<ChaveAcesso>\s*([^<]+)\s*<\/ChaveAcesso>/i)?.[1]?.trim() ??
    inner.match(/<chNFSe>\s*([^<]+)\s*<\/chNFSe>/i)?.[1]?.trim() ??
    null;

  const hasNfse =
    /<CompNfse[\s>]/i.test(inner) ||
    /<ListaNfse[\s>]/i.test(inner) ||
    /<Nfse[\s>]/i.test(inner);
  const situacao = inner.match(/<Situacao>\s*([^<]+)\s*<\/Situacao>/i)?.[1]?.trim();

  if (hasNfse && (codVerif || numero || chave) && erros.length === 0) {
    return {
      sucesso: true,
      erros: alertas,
      numero,
      codigoVerificacao: codVerif,
      // Não gravar código de verificação alfanumérico como "chave" numérica.
      chaveAcesso: chave || numero || codVerif,
      protocolo: protocolo || numero,
      xml: inner,
    };
  }

  if (hasNfse && (codVerif || numero || chave)) {
    return {
      sucesso: true,
      erros: alertas,
      numero,
      codigoVerificacao: codVerif,
      chaveAcesso: chave || numero || codVerif,
      protocolo: protocolo || numero,
      xml: inner,
    };
  }

  // Situacao 4 = processado com sucesso no TipLan (alertas A* não bloqueiam).
  if (situacao === '4' && erros.length === 0 && (codVerif || numero || hasNfse)) {
    return {
      sucesso: true,
      erros: alertas,
      numero,
      codigoVerificacao: codVerif,
      chaveAcesso: chave || numero || codVerif,
      protocolo: protocolo || numero,
      xml: inner,
    };
  }

  return {
    sucesso: false,
    erros: erros.length ? erros : alertas.length ? alertas : mensagens.length ? mensagens : ['Rejeitada pela prefeitura (ABRASF).'],
    numero: null,
    codigoVerificacao: null,
    chaveAcesso: null,
    protocolo: null,
    xml: inner,
  };
}

/** TipLan tsNumero: até 15 dígitos (com zeros à esquerda quando vierem do XML). */
function normalizarNumeroNfse(raw) {
  const digits = onlyDigits(raw);
  if (!digits) return null;
  if (digits.length > 15) return null;
  // Mantém padding do XML (ex.: 000000000000123); senão envia sem zeros extras.
  const asStr = String(raw ?? '').trim();
  if (/^\d{1,15}$/.test(asStr)) return asStr;
  return digits;
}

/** Número da NFS-e TipLan (não o RPS). */
function resolverNumeroNfseCancelamento(nota) {
  const xml = String(nota.xml_autorizado || '');
  const fromInf = xml.match(/<InfNfse[\s\S]*?<Numero>\s*([^<]+)\s*<\/Numero>/i)?.[1];
  const nInf = normalizarNumeroNfse(fromInf);
  if (nInf) return nInf;

  // CompNfse às vezes vem sem wrapper InfNfse no trecho salvo.
  const fromComp = xml.match(
    /<(?:Comp)?Nfse[\s\S]*?<Numero>\s*([^<]+)\s*<\/Numero>/i,
  )?.[1];
  const nComp = normalizarNumeroNfse(fromComp);
  if (nComp) return nComp;

  const prot = String(nota.protocolo_autorizacao || '').trim();
  // Protocolo TipLan = número da NFS-e (só dígitos, ≤15). Evita NumeroLote/timestamp (~13 dígitos).
  const nProt = normalizarNumeroNfse(prot);
  if (nProt && /^\d+$/.test(prot) && prot.length <= 12) return nProt;

  const chave = String(nota.chave_acesso || '').trim();
  // Só usa chave se for puramente numérica (não CódigoVerificacao alfanumérico).
  const nChave = normalizarNumeroNfse(chave);
  if (nChave && /^\d+$/.test(chave)) return nChave;

  return normalizarNumeroNfse(nota.numero);
}

/**
 * Emite NFS-e via RecepcionarLoteRpsSincrono (mesmo método do Delphi).
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

  const { privateKeyPem, certificatePem } = loadPfx(certPath, senha);
  let dadosXml = buildEnviarLoteRpsSincronoXml({
    nota,
    itens,
    perfil,
    cliente,
    config,
  });
  dadosXml = signLoteRps(dadosXml, privateKeyPem, certificatePem);

  const cab = buildCabecalho();
  const soap = soapRecepcionarLoteSincrono(cab, dadosXml);
  const url = WS_URL[Number(ambiente) === 2 ? 2 : 1];
  const pfxBuf = fs.readFileSync(certPath);

  console.info(
    '[nfse] gateway ABRASF Americana RecepcionarLoteRpsSincrono',
    url,
    'ItemListaServico',
    itemListaServico(config.codigo_tributacao_nacional),
    'NBS',
    codigoNbs(config),
  );

  const httpRes = await httpsSoap({
    url,
    body: soap,
    pfx: pfxBuf,
    passphrase: senha,
    soapAction: SOAP_ACTION_LOTE_SYNC,
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

  const parsed = parseLoteResult(httpRes.body);
  if (!parsed.sucesso) {
    const msg = parsed.erros.join(' | ') || 'Rejeitada pelo WebService ABRASF de Americana.';
    return { success: false, status: 'ERR', message: msg, xml_autorizado: parsed.xml };
  }

  return {
    success: true,
    status: '100',
    chave_acesso: parsed.chaveAcesso,
    // Número da NFS-e TipLan (InfNfse/Numero) — usado no cancelamento.
    protocolo_autorizacao: parsed.numero || parsed.protocolo,
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
  // TipLan tcIdentificacaoNfse: Numero, CpfCnpj, InscricaoMunicipal?, CodigoMunicipio — SEM CodigoVerificacao.
  const numeroNfse = resolverNumeroNfseCancelamento(nota);
  if (!numeroNfse) {
    throw new Error('Nota sem número da NFS-e para cancelar no ABRASF.');
  }

  console.info('[nfse] cancel ABRASF Americana', {
    numeroNfse,
    protocolo: nota.protocolo_autorizacao,
    rps: nota.numero,
    codVerif: nota.codigo_verificacao,
  });

  const { privateKeyPem, certificatePem } = loadPfx(certPath, senha);
  const idPed = `Cancel_${numeroNfse}`;
  let ped =
    `<CancelarNfseEnvio xmlns="${NS_ABRASF}">` +
    `<Pedido>` +
    `<InfPedidoCancelamento Id="${idPed}">` +
    `<IdentificacaoNfse>` +
    `<Numero>${escapeXml(numeroNfse)}</Numero>` +
    `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
    (im ? `<InscricaoMunicipal>${im}</InscricaoMunicipal>` : '') +
    `<CodigoMunicipio>3501608</CodigoMunicipio>` +
    `</IdentificacaoNfse>` +
    // 1=Erro emissão → TipLan X206 (exige SubstituirNfse). CancelarNfse aceita 2=Serviço não prestado.
    `<CodigoCancelamento>2</CodigoCancelamento>` +
    `</InfPedidoCancelamento>` +
    `</Pedido>` +
    `</CancelarNfseEnvio>`;

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: C14N_INCLUSIVE,
    getKeyInfoContent: SignedXml.getKeyInfoContent,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='InfPedidoCancelamento']",
    uri: `#${idPed}`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      C14N_INCLUSIVE,
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  // TipLan/ABRASF: Signature irmã de InfPedidoCancelamento (dentro de Pedido).
  sig.computeSignature(ped, {
    location: {
      reference: "//*[local-name(.)='InfPedidoCancelamento']",
      action: 'after',
    },
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
    const plain = httpRes.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    return {
      success: false,
      status: 'ERR',
      message: `Cancelamento ABRASF HTTP ${httpRes.statusCode}: ${plain || 'falha no WebService'}`,
    };
  }

  const inner = decodeSoapInner(httpRes.body);
  const mensagens = [
    ...inner.matchAll(
      /<Codigo>\s*([^<]+)\s*<\/Codigo>[\s\S]*?<Mensagem>\s*([^<]+)\s*<\/Mensagem>/gi,
    ),
  ].map((m) => `${m[1].trim()}: ${m[2].trim()}`);

  const fault =
    inner.match(/<faultstring>\s*([^<]+)\s*<\/faultstring>/i)?.[1]?.trim() ||
    inner.match(/<MensagemRetorno>[\s\S]*?<Mensagem>\s*([^<]+)\s*<\/Mensagem>/i)?.[1]?.trim();

  const ok =
    /<Confirmacao[\s>]/i.test(inner) ||
    (/<DataHora[\s>]/i.test(inner) && /CancelarNfseResposta/i.test(inner));

  // Erros E*/X*/L* impedem; A* são alertas.
  const erros = mensagens.filter((m) => !/^A\d+/i.test(m));

  if (!ok || erros.length) {
    const msg =
      erros.join(' | ') ||
      mensagens.join(' | ') ||
      fault ||
      inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) ||
      'Cancelamento rejeitado pela prefeitura (ABRASF).';
    return {
      success: false,
      status: 'ERR',
      message: msg,
      numero_enviado: numeroNfse,
    };
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
  resolverNumeroNfseCancelamento,
  itemListaServico,
  codigoCnae,
  codigoTributacaoMunicipioAbrasf,
  codigoNbs,
  buildEnviarLoteRpsSincronoXml,
};
