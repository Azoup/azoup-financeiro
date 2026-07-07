const { onlyDigits } = require('./nfseWizard');

function humanizeNfseRejection(message, ibge) {
  const raw = String(message ?? '').trim();
  if (!raw) return 'NFS-e rejeitada pela SEFIN.';

  if (/E0039/i.test(raw)) {
    const cod = onlyDigits(ibge).padStart(7, '0').slice(0, 7) || 'informado';
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
