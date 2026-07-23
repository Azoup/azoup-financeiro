const { onlyDigits } = require('./nfseWizard');

function humanizeNfseRejection(message, ibge) {
  const raw = String(message ?? '').trim();
  if (!raw) return 'NFS-e rejeitada pela SEFIN.';

  if (/L327|X327/i.test(raw)) {
    const optMatch = raw.match(/OptanteSimplesNacional\s*=\s*(\d)/i);
    const optInfo = optMatch
      ? `Enviado OptanteSimplesNacional=${optMatch[1]} (1=Simples, 2=Não).`
      : '';
    const retryFail = /já tentou invertido|retry Optante/i.test(raw);
    return [
      'X327 — Optante Simples no XML ≠ cadastro deste CNPJ na TipLan/prefeitura.',
      optInfo,
      retryFail
        ? 'O Azoup já tentou o valor invertido e TipLan rejeitou de novo — atualize o regime deste CNPJ em nfse.americana.sp.gov.br (Tributação Normal vs Simples).'
        : 'Após redeploy o sistema tenta 1x o Optante invertido. Se ainda falhar: alinhe o portal Americana ou use "Optante ME/EPP" no Emitente 2.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (/X345|Inscrição Municipal.*não está vinculada|Inscricao Municipal.*nao esta vinculada/i.test(raw)) {
    return [
      'X345 — A Inscrição Municipal informada não está vinculada a este CNPJ na prefeitura.',
      'Em Configurações › NFS-e › Emitente 2, use a IM do CNPJ 66.639.480/0001-43 (não a do outro CNPJ/Simples).',
      'Confira no portal nfse.americana.sp.gov.br o CCM/IM cadastrado para esse CNPJ.',
    ].join(' ');
  }

  if (/X138|não autorizado a realizar o serviço|nao autorizado a realizar o serviço/i.test(raw)) {
    return [
      'X138 — Certificado/usuário sem autorização para emitir esse serviço neste CNPJ.',
      'No portal da NFS-e de Americana: Autorização para Emissão / WebService para o CNPJ do Emitente 2.',
      'O .pfx usado na emissão deve ser do mesmo CNPJ 66.639.480/0001-43.',
    ].join(' ');
  }

  if (/X52|tomador.*próprio prestador|tomador.*proprio prestador/i.test(raw)) {
    return [
      'X52 — O tomador (cliente) tem o mesmo CNPJ do prestador (emitente).',
      'Não emita NFS-e para a própria empresa. Use um cliente com outro CPF/CNPJ na mensalidade/teste.',
    ].join(' ');
  }

  if (/L2103|TSDec15V2|vTotTribMun/i.test(raw)) {
    return [
      'L2103 — Valor monetário inválido na DPS (deve ter 2 casas decimais, ex.: 0.20).',
      'Reemitir após o último deploy; se persistir, verifique o valor da nota.',
    ].join(' ');
  }

  if (/E0314|E314/i.test(raw)) {
    return [
      'E314 — Código de tributação municipal (cTribMun) inválido ou inexistente.',
      'Em Configurações › NFS-e, informe o código municipal conforme a lista da prefeitura.',
      'Para São Paulo (Paulistana), use o código de serviço de 4–5 dígitos da lista municipal.',
    ].join(' ');
  }

  if (/A14|ValorISS informado indevidamente/i.test(raw)) {
    return [
      'A14 — Em Americana (TipLan/Simples) o ValorISS não deve ser enviado: a prefeitura calcula o ISS.',
      'Faça redeploy da versão que omite ValorIss e reemitir.',
    ].join(' ');
  }

  if (/X30|E30|Item da lista de serviço/i.test(raw)) {
    return [
      'X30 — Item da lista de serviço inválido ou inexistente no cadastro municipal.',
      'Em Configurações › NFS-e, confira o código de tributação nacional (ex.: 010701 → ItemListaServico 01.07).',
      'Compare com o ItemListaServico de uma nota autorizada no Delphi.',
      'No ABRASF de Americana, o sistema converte o cTribMun antigo 001 para o subitem 01.07.',
    ].join(' ');
  }

  if (/X160/i.test(raw)) {
    const detail = raw.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (/ItemListaServico|00\.01|tsItemListaServico/i.test(detail)) {
      return [
        'X160 — ItemListaServico inválido no schema TipLan.',
        `Detalhe TipLan: ${detail}`,
        'Em Configurações › NFS-e do emitente, o código de tributação nacional deve ser o da LC 116 (ex.: 010701 → 01.07), não o municipal ADN (001) nem o cClassTrib (000001).',
        'Faça redeploy e reemitir.',
      ].join(' ');
    }
    return [
      'X160 — XML rejeitado pelo schema ABRASF TipLan de Americana (estrutura inválida).',
      `Detalhe TipLan: ${detail}`,
      'No Regime Normal, Situação PIS/COFINS não deve ser 00 (use 01). Confira também IndOp/CST/cClassTrib.',
      'Faça redeploy, reemitir, e se falhar copie o texto completo em Notas fiscais › Rejeição.',
    ].join(' ');
  }

  if (/X206|E206/i.test(raw)) {
    return [
      'X206 — Motivo "erro na emissão" (código 1) não pode ser usado no CancelarNfse.',
      'Nesse caso a prefeitura exige substituição da NFS-e (SubstituirNfse) ou o portal.',
      'No Azoup o cancelamento envia código 2 (serviço não prestado). Faça redeploy e tente de novo.',
    ].join(' ');
  }

  if (/E79|E80|E86|não encontrada|nao encontrada|inexistente/i.test(raw)) {
    return [
      raw.split('|')[0]?.trim() || raw,
      'O número enviado no cancelamento deve ser o da NFS-e (InfNfse/Numero), não o RPS.',
      'Confira no portal nfse.americana.sp.gov.br o número da nota e se o prazo de cancelamento ainda vale.',
    ].join(' ');
  }

  if (/L979|número do lote.*já existe|numero do lote.*ja existe/i.test(raw)) {
    return [
      'L979 — Número do lote já usado neste CNPJ.',
      'Faça redeploy da versão com NumeroLote único e reemitir (não reutilize a mesma tentativa).',
    ].join(' ');
  }

  if (/L1268|Chave de acesso da NFS-e enviada já existe/i.test(raw)) {
    return [
      'L1268 — Este RPS/chave já existe no Ambiente Nacional (ADN).',
      'A emissão anterior pode ter sido aceita mesmo com alerta. Confira em nfse.americana.sp.gov.br.',
      'Para nova tentativa no Azoup, use "Reemitir" (gera novo número de RPS) ou crie uma nota nova.',
    ].join(' ');
  }

  if (/L906/i.test(raw)) {
    return [
      'L906 — A prefeitura rejeitou a atividade/serviço deste envio para o CNPJ.',
      '1) No Delphi, anote ItemListaServico / CódigoTributacaoMunicipio / CNAE da nota que autoriza.',
      '2) Em Configurações › NFS-e, use os mesmos códigos (cTribNac 6 dígitos → ItemListaServico; cTribMun).',
      '3) Em nfse.americana.sp.gov.br › Autorização para Emissão, confirme liberação do WebService.',
    ].join(' ');
  }

  if (/1202/i.test(raw)) {
    return [
      '1202 — Prestador não encontrado no Cadastro Municipal de São Paulo (CCM).',
      'A Paulistana só aceita CNPJ com CCM válido na capital. Confira em Configurações › NFS-e:',
      '(1) código IBGE 3550308; (2) Inscrição Municipal = CCM de São Paulo (não a IM de Americana);',
      '(3) CNPJ do certificado A1 igual ao cadastrado em nfpaulistana.prefeitura.sp.gov.br.',
      'Sem CCM em São Paulo, use Americana (IBGE 3501608) e a API municipal — a API de SP não substitui cadastro na capital.',
    ].join(' ');
  }

  if (/1203|1204/i.test(raw) && /1202/i.test(raw) === false) {
    return [
      raw.split('|')[0]?.trim() || raw,
      'Os totais do lote não bateram com os RPS lidos pela Paulistana.',
      'Confira CCM (máx. 8 dígitos), valor da nota e código de serviço SP (4–5 dígitos).',
    ].join(' ');
  }

  if (/E0039/i.test(raw)) {
    const cod = onlyDigits(ibge).padStart(7, '0').slice(0, 7) || 'informado';
    if (cod === '3501608') {
      return [
        `E0039 — Americana (IBGE ${cod}): a prefeitura não aceita emissão pelo SEFIN nacional.`,
        'O sistema deve usar o WebService ABRASF TipLan (nfse.americana.sp.gov.br). Faça redeploy da versão mais recente.',
        'Credencie o CNPJ do certificado A1 e a Autorização para Emissão no portal da prefeitura.',
      ].join(' ');
    }
    return [
      `E0039 — O município IBGE ${cod} não está habilitado no Sistema Nacional NFS-e para emissão pelo emissor público nacional (homologação).`,
      'Confira se o código IBGE da cidade do prestador está correto (7 dígitos, ex.: 3550308).',
      'O município precisa ter aderido e concluído a parametrização no portal nacional NFS-e (gov.br/nfse).',
      'Se a prefeitura ainda usa sistema próprio (sem emissor nacional), esta integração não emitirá até a adesão.',
      'Orientação: contate a contabilidade/prefeitura ou consulte a adesão em https://www.gov.br/nfse/pt-br/municipios',
    ].join(' ');
  }

  return raw.replace(/^NFSE_Autorizacao:\s*/i, '');
}

/** Interpreta retorno de ConsultarConvenio (nfewizard / ADN). */
function parseConvenioResponse(ret) {
  const body = ret?.response ?? ret?.data ?? ret;
  const params = body?.parametrosConvenio ?? body?.parametros ?? body;
  const aderente = params?.aderenteAmbienteNacional ?? params?.aderente_ambiente_nacional;
  const tipo = params?.tipoConvenio ?? params?.tipo_convenio;
  const situacao = params?.situacaoEmissaoPadraoContribuintesRFB ?? params?.situacao;

  const ok =
    ret?.success === true ||
    body?.success === true ||
    aderente === '1' ||
    aderente === 1 ||
    Boolean(tipo);

  return {
    ok,
    aderente: aderente != null ? String(aderente) : null,
    tipoConvenio: tipo != null ? String(tipo) : null,
    situacao: situacao != null ? String(situacao) : null,
    raw: body,
  };
}

async function validarConvenioMunicipio(wizard, ibge) {
  const cod = onlyDigits(ibge).padStart(7, '0').slice(0, 7);
  if (cod.length < 7) {
    return {
      ok: false,
      message: 'Código IBGE do município inválido (informe 7 dígitos).',
    };
  }

  try {
    const ret = await wizard.ConsultarConvenio({ codigoMunicipio: cod });
    const parsed = parseConvenioResponse(ret);
    if (parsed.ok) {
      return { ok: true, ibge: cod, ...parsed };
    }
    return {
      ok: false,
      ibge: cod,
      message: humanizeNfseRejection('E0039', cod),
      ...parsed,
    };
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/E0039|parametrizado|convenio|404|not found/i.test(msg)) {
      return { ok: false, ibge: cod, message: humanizeNfseRejection('E0039', cod) };
    }
    return {
      ok: false,
      ibge: cod,
      message: `Não foi possível consultar o convênio do município ${cod}: ${msg}`,
    };
  }
}

module.exports = { humanizeNfseRejection, parseConvenioResponse, validarConvenioMunicipio };
