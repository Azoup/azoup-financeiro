const { loadSicoobCredentials } = require('./sicoobCredentials');
const {
  alterarBoletoSicoobApi,
  buildPagadorFromCliente,
  cleanupCert,
  consultarBoletoSicoobApi,
  obterSegundaViaSicoobApi,
  textoSemAcento,
} = require('./sicoobClient');
const {
  enriquecerClienteComCep,
  persistirCidadeClienteSeCorrigida,
} = require('./resolverEnderecoPagador');

function campoJaAplicado(msg) {
  return /ao menos um campo deve ser alterado/i.test(String(msg ?? ''));
}

function cidadePagador(cliente) {
  return textoSemAcento(cliente?.cidade, 'Nao informado');
}

function camposPagadorDoCliente(cliente) {
  const endereco = [cliente.logradouro, cliente.numero, cliente.complemento]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .join(', ');
  const uf = String(cliente.estado ?? cliente.uf ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const cidadeUf = [cliente.cidade, uf]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .join(' / ');
  const cep = String(cliente.cep ?? '').trim();
  const nome = String(
    cliente.nome || cliente.razao_social || cliente.nome_empresa || cliente.nome_fantasia || '',
  ).trim();
  const doc = String(cliente.cnpj || cliente.documento || cliente.cpf || '').trim();
  return {
    pagador_nome: nome || '—',
    pagador_documento: doc || '—',
    pagador_endereco: endereco || '—',
    pagador_cidade_uf_cep: [cidadeUf, cep].filter(Boolean).join(' · ') || '—',
  };
}

async function resolveClienteId(admin, boleto) {
  if (boleto.mensalidade_id) {
    const { data } = await admin
      .from('mensalidades')
      .select('cliente_id')
      .eq('id', boleto.mensalidade_id)
      .maybeSingle();
    return data?.cliente_id ?? null;
  }
  if (boleto.venda_id) {
    const { data } = await admin.from('vendas').select('cliente_id').eq('id', boleto.venda_id).maybeSingle();
    return data?.cliente_id ?? null;
  }
  return null;
}

async function salvarPdfBase64(admin, userId, boletoId, base64) {
  if (!base64) return {};
  const buf = Buffer.from(String(base64), 'base64');
  if (!buf.length) return {};
  const path = `${userId}/boletos/${boletoId}.pdf`;
  const { error } = await admin.storage
    .from('boletos_sicoob')
    .upload(path, buf, { contentType: 'application/pdf', upsert: true });
  if (error) return {};
  const { data } = await admin.storage.from('boletos_sicoob').createSignedUrl(path, 60 * 60 * 24 * 30);
  return { pdf_storage_path: path, pdf_url: data?.signedUrl ?? null };
}

async function atualizarPagadorBoletoSicoob(admin, userId, boletoId) {
  const { data: boleto, error } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!boleto) throw new Error('Boleto não encontrado.');
  if (boleto.status_registro === 'pago') throw new Error('Boleto pago não tem endereço para alterar.');
  if (boleto.status_registro === 'baixado') throw new Error('Boleto cancelado não tem endereço para alterar.');
  if (boleto.tipo_emissao !== 'sicoob' || !boleto.nosso_numero_banco) {
    throw new Error('Só atualizo o PDF oficial de boleto já registrado no Sicoob.');
  }

  const clienteId = await resolveClienteId(admin, boleto);
  if (!clienteId) throw new Error('Não foi possível identificar o cliente do boleto.');
  const { data: clienteRaw, error: cliErr } = await admin.from('clientes').select('*').eq('id', clienteId).single();
  if (cliErr || !clienteRaw) throw new Error(cliErr?.message ?? 'Cliente não encontrado.');
  const { cliente, corrigiu } = await enriquecerClienteComCep(clienteRaw);
  await persistirCidadeClienteSeCorrigida(admin, clienteId, clienteRaw, cliente, corrigiu);

  const campos = camposPagadorDoCliente(cliente);
  const cidade = cidadePagador(cliente);
  const creds = await loadSicoobCredentials(admin, userId, boleto.emitente_id);
  if (!creds) throw new Error('Sicoob inativo ou sem certificado — o PDF não foi atualizado.');

  try {
    const antes = await consultarBoletoSicoobApi({
      config: creds.config,
      certPath: creds.certPath,
      senha: creds.senha,
      boleto,
    });
    if (antes.liquidado) throw new Error('Este boleto já está pago no Sicoob. O PDF não foi atualizado.');

    const pagador = buildPagadorFromCliente(cliente);
    const dadosPagador = {
      endereco: pagador.endereco,
      bairro: pagador.bairro,
      cidade: pagador.cidade,
      cep: pagador.cep,
      uf: pagador.uf,
    };
    const tentativas = [
      { alteracaoDadosPagador: dadosPagador },
      { dadosPagador },
      { pagador: dadosPagador },
    ];
    let ultimoErro = null;
    let aceitou = false;
    for (const objeto of tentativas) {
      try {
        await alterarBoletoSicoobApi({
          config: creds.config,
          certPath: creds.certPath,
          senha: creds.senha,
          nossoNumero: boleto.nosso_numero_banco,
          objeto,
        });
        aceitou = true;
        break;
      } catch (e) {
        if (campoJaAplicado(e.message)) {
          aceitou = true;
          break;
        }
        ultimoErro = e;
      }
    }
    if (!aceitou && ultimoErro) throw ultimoErro;

    const extras = { ...campos };
    let pdfAtualizado = false;
    const via = await obterSegundaViaSicoobApi({
      config: creds.config,
      certPath: creds.certPath,
      senha: creds.senha,
      nossoNumero: boleto.nosso_numero_banco,
    });
    if (via.linha_digitavel) extras.linha_digitavel = via.linha_digitavel;
    if (via.codigo_barras) extras.codigo_barras = via.codigo_barras;
    Object.assign(extras, await salvarPdfBase64(admin, userId, boleto.id, via.pdf_base64));
    pdfAtualizado = Boolean(extras.pdf_url);

    const { error: upErr } = await admin.from('boletos_parcela_venda').update(extras).eq('id', boleto.id);
    if (upErr) throw new Error(upErr.message);

    try {
      await admin.from('historico_boleto_sicoob').insert({
        boleto_id: boleto.id,
        acao: 'ATUALIZAR_PAGADOR_SICOOB',
        usuario_id: userId,
        detalhes: `Cidade do pagador atualizada para ${cidade}.`,
      });
    } catch {
      /* histórico não impede a correção */
    }

    return {
      success: true,
      cidade,
      pdfAtualizado,
      message: pdfAtualizado
        ? `PDF oficial atualizado com ${cidade}. Pode enviar para o cliente.`
        : `O Sicoob aceitou ${cidade}, mas o PDF novo ainda não veio. Abra o boleto daqui a alguns minutos.`,
    };
  } finally {
    cleanupCert(creds.certPath);
  }
}

module.exports = { atualizarPagadorBoletoSicoob };
