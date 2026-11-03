/**
 * Corrige cidade/UF do pagador pelo CEP (ViaCEP).
 * Evita boleto com CEP de uma cidade e nome de outra (ex.: CEP 13458-430 + Goiânia).
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

async function consultarViaCep(cepDigits) {
  const cep = onlyDigits(cepDigits);
  if (cep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.erro) return null;
    const localidade = String(data.localidade ?? '').trim();
    const uf = String(data.uf ?? '')
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
  } catch {
    return null;
  }
}

/**
 * Se o CEP existir no ViaCEP e a cidade do cadastro divergir, usa a do CEP.
 * Também preenche cidade/UF vazios.
 */
async function enriquecerClienteComCep(cliente) {
  if (!cliente || typeof cliente !== 'object') return { cliente, corrigiu: false, viaCep: null };
  const via = await consultarViaCep(cliente.cep);
  if (!via) return { cliente, corrigiu: false, viaCep: null };

  const cidadeAtual = String(cliente.cidade ?? '').trim();
  const ufAtual = String(cliente.estado ?? cliente.uf ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const cidadeDivergente =
    Boolean(cidadeAtual) && textoNorm(cidadeAtual) !== textoNorm(via.localidade);
  const cidadeVazia = !cidadeAtual;
  const ufDivergente = Boolean(via.uf) && Boolean(ufAtual) && ufAtual !== via.uf;
  const ufVazia = !ufAtual;

  if (!cidadeDivergente && !cidadeVazia && !ufDivergente && !ufVazia) {
    return { cliente, corrigiu: false, viaCep: via };
  }

  const next = {
    ...cliente,
    cidade: via.localidade,
    estado: via.uf || cliente.estado || cliente.uf || 'SP',
    uf: via.uf || cliente.uf || cliente.estado || 'SP',
  };
  return { cliente: next, corrigiu: true, viaCep: via };
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
