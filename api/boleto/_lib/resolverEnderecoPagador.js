/**
 * Corrige cidade/UF do pagador pelo CEP.
 * ViaCEP primeiro; BrasilAPI como fallback (Vercel às vezes falha no ViaCEP).
 * Evita boleto com CEP de uma cidade e nome de outra (ex.: CEP 13450-350 + Goiânia).
 */

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function textoNorm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function fetchJsonCep(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json();
}

function fromViaCep(data) {
  if (!data || data.erro) return null;
  const localidade = String(data.localidade ?? data.city ?? '').trim();
  const uf = String(data.uf ?? data.state ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  if (!localidade) return null;
  return {
    localidade,
    uf,
    bairro: String(data.bairro ?? '').trim(),
    logradouro: String(data.logradouro ?? '').trim(),
  };
}

function fromBrasilApi(data) {
  if (!data || data.message || data.errors) return null;
  const localidade = String(data.city ?? '').trim();
  const uf = String(data.state ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  if (!localidade) return null;
  return {
    localidade,
    uf,
    bairro: String(data.neighborhood ?? '').trim(),
    logradouro: String(data.street ?? '').trim(),
  };
}

/** Consulta CEP: ViaCEP → BrasilAPI → nova tentativa ViaCEP. */
async function consultarViaCep(cepDigits) {
  const cep = onlyDigits(cepDigits).padStart(8, '0').slice(0, 8);
  if (cep.length !== 8) return null;

  try {
    const via = fromViaCep(await fetchJsonCep(`https://viacep.com.br/ws/${cep}/json/`));
    if (via) return via;
  } catch {
    /* tenta BrasilAPI */
  }

  try {
    const br = fromBrasilApi(await fetchJsonCep(`https://brasilapi.com.br/api/cep/v2/${cep}`));
    if (br) return br;
  } catch {
    /* ignore */
  }

  try {
    await new Promise((r) => setTimeout(r, 400));
    return fromViaCep(await fetchJsonCep(`https://viacep.com.br/ws/${cep}/json/`));
  } catch {
    return null;
  }
}

/**
 * Sempre alinha cidade/UF ao CEP quando a consulta resolver.
 * @param {{ obrigatorio?: boolean }} opts — se true e o CEP for válido mas a consulta falhar, lança erro
 *   (usado na emissão Sicoob para não registrar de novo com Goiânia).
 */
async function enriquecerClienteComCep(cliente, opts = {}) {
  if (!cliente || typeof cliente !== 'object') return { cliente, corrigiu: false, viaCep: null };
  const cepDigits = onlyDigits(cliente.cep).padStart(8, '0').slice(0, 8);
  const via = await consultarViaCep(cepDigits);
  if (!via) {
    if (opts.obrigatorio && cepDigits.length === 8) {
      throw new Error(
        `Não consegui confirmar a cidade pelo CEP ${cepDigits}. ` +
          'Confira o CEP no cadastro do cliente e tente emitir de novo.',
      );
    }
    return { cliente, corrigiu: false, viaCep: null };
  }

  const cidadeAtual = String(cliente.cidade ?? '').trim();
  const ufAtual = String(cliente.estado ?? cliente.uf ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const cidadeMudou = textoNorm(cidadeAtual) !== textoNorm(via.localidade);
  const ufMudou = Boolean(via.uf) && ufAtual !== via.uf;
  const corrigiu = cidadeMudou || ufMudou || !cidadeAtual || !ufAtual;

  const next = {
    ...cliente,
    // Sempre a cidade/UF do CEP — nunca confiar em Goiânia (ou outro município) divergente no cadastro.
    cidade: via.localidade,
    estado: via.uf || cliente.estado || cliente.uf || 'SP',
    uf: via.uf || cliente.uf || cliente.estado || 'SP',
  };
  if (!String(next.bairro ?? '').trim() && via.bairro) next.bairro = via.bairro;
  if (!String(next.logradouro ?? '').trim() && via.logradouro) next.logradouro = via.logradouro;

  return { cliente: next, corrigiu, viaCep: via };
}

/** Persiste cidade/UF corrigidas no cadastro do cliente (não sobrescreve o resto). */
async function persistirCidadeClienteSeCorrigida(admin, clienteId, clienteAntes, clienteDepois, corrigiu) {
  if (!corrigiu || !admin || !clienteId) return;
  const cidade = String(clienteDepois.cidade ?? '').trim();
  const uf = String(clienteDepois.estado ?? clienteDepois.uf ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  if (!cidade) return;
  const mesma =
    textoNorm(clienteAntes?.cidade) === textoNorm(cidade) &&
    String(clienteAntes?.estado ?? clienteAntes?.uf ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 2) === uf;
  if (mesma) return;
  try {
    await admin
      .from('clientes')
      .update({ cidade, estado: uf || null })
      .eq('id', clienteId);
  } catch {
    /* emissão segue mesmo se o update do cadastro falhar */
  }
}

module.exports = {
  consultarViaCep,
  enriquecerClienteComCep,
  persistirCidadeClienteSeCorrigida,
  textoNorm,
  onlyDigits,
};
