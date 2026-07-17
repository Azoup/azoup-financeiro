/** Valida que o XML ABRASF gerado contém os mesmos campos do Delphi. */
const { buildEnviarLoteRpsSincronoXml, itemListaServico, codigoNbs, codigoTributacaoMunicipioAbrasf } =
  require('../api/nfe/_lib/nfseAbrasfAmericana');

const xml = buildEnviarLoteRpsSincronoXml({
  nota: {
    numero: 1447,
    serie: '1',
    data_emissao: '2026-07-17',
    competencia: '07/2026',
    valor_total: 2,
  },
  itens: [{ descricao: 'PRESTACAO DE SERVICO- MANUTENCAO' }],
  perfil: { documento: '05.320.214/0001-69' },
  cliente: {
    cnpj: '66639480000143',
    nome: 'AZFS TECNOLOGIA LTDA',
    logradouro: 'NOVE DE JULHO',
    numero: '637',
    complemento: 'DE 1093 AO FIM - LADO IMPAR',
    bairro: 'JARDIM SAO DOMINGOS',
    estado: 'SP',
    cep: '13471140',
    email: 'jessica@azoup.com.br',
  },
  config: {
    inscricao_municipal: '69842',
    codigo_ibge_emitente: '3501608',
    codigo_tributacao_nacional: '010701',
    codigo_tributacao_municipal: '001',
    codigo_nbs: '106043000',
    op_simp_nac: 3,
    serie: '1',
  },
});

const required = [
  'EnviarLoteRpsSincronoEnvio',
  'LoteRps Id="Lote_1447"',
  'versao="2.03"',
  '<NumeroLote>1447</NumeroLote>',
  '<Cnpj>05320214000169</Cnpj>',
  '<InscricaoMunicipal>69842</InscricaoMunicipal>',
  '<QuantidadeRps>1</QuantidadeRps>',
  'Id="Dec_1447"',
  '<Numero>1447</Numero>',
  '<Serie>1</Serie>',
  '<Tipo>1</Tipo>',
  '<DataEmissao>2026-07-17</DataEmissao>',
  '<Status>1</Status>',
  '<Competencia>2026-07-17</Competencia>',
  '<ValorServicos>2.00</ValorServicos>',
  '<SituacaoTributariaPISCOFINS>00</SituacaoTributariaPISCOFINS>',
  '<IssRetido>2</IssRetido>',
  '<ItemListaServico>01.07</ItemListaServico>',
  '<CodigoCnae>6209100</CodigoCnae>',
  '<CodigoTributacaoMunicipio>01.07</CodigoTributacaoMunicipio>',
  '<CodigoNbs>115013000</CodigoNbs>',
  '<Discriminacao>PRESTACAO DE SERVICO- MANUTENCAO</Discriminacao>',
  '<CodigoMunicipio>3501608</CodigoMunicipio>',
  '<ExigibilidadeISS>1</ExigibilidadeISS>',
  '<MunicipioIncidencia>3501608</MunicipioIncidencia>',
  '<Tomador>',
  '<Complemento>',
  '<Contato><Email>jessica@azoup.com.br</Email></Contato>',
  '<OptanteSimplesNacional>1</OptanteSimplesNacional>',
  '<IncentivoFiscal>2</IncentivoFiscal>',
];

const forbidden = ['GerarNfseEnvio', 'IBSCBS', 'TomadorServico', '<Aliquota>', '<ValorIss>'];

let ok = true;
for (const s of required) {
  if (!xml.includes(s)) {
    console.error('MISSING:', s);
    ok = false;
  }
}
for (const s of forbidden) {
  if (xml.includes(s)) {
    console.error('UNEXPECTED:', s);
    ok = false;
  }
}

console.log('helpers', {
  item: itemListaServico('010701'),
  mun: codigoTributacaoMunicipioAbrasf({
    codigo_tributacao_municipal: '001',
    codigo_tributacao_nacional: '010701',
  }),
  nbs: codigoNbs({ codigo_nbs: '106043000' }),
});
console.log(ok ? 'XML Delphi-compatible: OK' : 'XML Delphi-compatible: FAIL');
process.exit(ok ? 0 : 1);
