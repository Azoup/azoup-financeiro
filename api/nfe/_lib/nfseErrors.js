const { onlyDigits } = require('./nfseWizard');

function humanizeNfseRejection(message, ibge) {
  const raw = String(message ?? '').trim();
  if (!raw) return 'NFS-e rejeitada pela SEFIN.';

  if (/L327/i.test(raw)) {
    return [
      'L327 — A opção de tributação na NFS-e não confere com o perfil do prestador na prefeitura.',
      'Em Configurações › NFS-e, ajuste "Situação no Simples Nacional" para o mesmo valor cadastrado no portal da prefeitura (americanahomologacao.nfe.com.br).',
      'Ex.: se a empresa é ME/EPP no Simples, selecione opção 3 — não "Não optante" (1).',
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

  if (/L906/i.test(raw)) {
    return [
      'L906 — O código de atividade (ex.: 01.07) não está liberado para emissão neste CNPJ na prefeitura de Americana.',
      'Opções: (1) liberar a atividade no portal americanahomologacao.nfe.com.br; ou (2) se a empresa for de São Paulo capital, altere o IBGE para 3550308 e use a Paulistana (CCM + código de serviço SP).',
    ].join(' ');
  }

  if (/E0039/i.test(raw)) {
    const cod = onlyDigits(ibge).padStart(7, '0').slice(0, 7) || 'informado';
    if (cod === '3501608') {
      return [
        `E0039 — Americana (IBGE ${cod}): a prefeitura não aceita emissão direta pelo SEFIN nacional.`,
        'O sistema deve usar a API municipal (americanahomologacao.nfe.com.br). Faça redeploy da versão mais recente.',
        'Credencie o CNPJ do certificado A1 no portal de homologação da prefeitura de Americana.',
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
