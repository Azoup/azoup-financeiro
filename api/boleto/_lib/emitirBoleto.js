const { getAdmin, getUserFromBearer } = require('../../nfe/_lib/supabaseAdmin');
const { decryptCertPassword } = require('../../nfe/_lib/crypto');
const { resolveCertificadoAtivo } = require('./sicoobCredentials');
const {
  buildSicoobPayload,
  cleanupCert,
  downloadCertToTemp,
  emitirBoletoSicoobApi,
  listarBoletosPagadorSicoobApi,
} = require('./sicoobClient');
const { recusarSegundoBoletoNoDia } = require('./umBoletoPorClienteDia');

async function resolveClienteId(admin, boleto) {
  if (boleto.mensalidade_id) {
    const { data } = await admin.from('mensalidades').select('cliente_id').eq('id', boleto.mensalidade_id).maybeSingle();
    return data?.cliente_id ?? null;
  }
  if (boleto.venda_id) {
    const { data } = await admin.from('vendas').select('cliente_id').eq('id', boleto.venda_id).maybeSingle();
    return data?.cliente_id ?? null;
  }
  return null;
}

function diaIso(offsetDias) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

function seuNumeroAlvo(valor) {
  return String(valor ?? '').trim().slice(0, 15).toUpperCase();
}

function numeroBanco(boleto) {
  const n = Number(String(boleto?.nossoNumero ?? boleto?.nosso_numero ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Consulta títulos em aberto do pagador. consultaOk false = não dá para afirmar que o banco não tem o boleto. */
async function acharBoletosJaEmitidos({ config, certPath, senha, cliente, seuNumero, vencimento }) {
  const alvo = seuNumeroAlvo(seuNumero);
  if (!alvo) return { boletos: [], consultaOk: false, erro: 'Seu número vazio.' };
  const doc = String(cliente?.cnpj ?? cliente?.cpf ?? cliente?.documento ?? '');
  const venc = String(vencimento ?? '').slice(0, 10);
  const dataInicio = venc && venc < diaIso(-120) ? venc : diaIso(-120);
  const dataFim = venc && venc > diaIso(180) ? venc : diaIso(180);
  let lista = [];
  try {
    lista = await listarBoletosPagadorSicoobApi({
      config,
      certPath,
      senha,
      numeroCpfCnpj: doc,
      dataInicio,
      dataFim,
    });
  } catch (error) {
    return { boletos: [], consultaOk: false, erro: error?.message ?? 'Consulta do pagador falhou.' };
  }
  const boletos = lista
    .filter((b) => seuNumeroAlvo(b?.seuNumero ?? b?.seu_numero) === alvo)
    .sort((a, b) => numeroBanco(b) - numeroBanco(a));
  return { boletos, consultaOk: true, erro: null };
}

async function acoesEmissao(admin, boletoId) {
  const { data, error } = await admin
    .from('historico_boleto_sicoob')
    .select('acao, criado_em')
    .eq('boleto_id', boletoId)
    .in('acao', ['TENTATIVA_EMISSAO', 'EMISSAO', 'EMISSAO_RECUSADA', 'CONSULTA_SEM_TITULO', 'ERRO'])
    .order('criado_em', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Tentativa que pode ter chegado no banco e ainda não foi encerrada. */
function tentativaIncerta(acoes) {
  for (const acao of acoes) {
    if (acao.acao === 'EMISSAO' || acao.acao === 'EMISSAO_RECUSADA' || acao.acao === 'CONSULTA_SEM_TITULO') {
      return null;
    }
    if (acao.acao === 'TENTATIVA_EMISSAO' || acao.acao === 'ERRO') return acao;
  }
  return null;
}

async function registrarAcao(admin, boletoId, userId, acao, detalhes, payload) {
  const { error } = await admin.from('historico_boleto_sicoob').insert({
    boleto_id: boletoId,
    acao,
    usuario_id: userId,
    detalhes,
    payload_resposta: payload ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Só uma emissão por carnê segue. A segunda requisição paralela não chama o banco. */
async function reivindicarEmissao(admin, boleto) {
  const claim = `LOCK:${Date.now()}`;
  let q = admin
    .from('boletos_parcela_venda')
    .update({
      tipo_emissao: 'sicoob',
      status_registro: 'pendente',
      mensagem_erro_registro: claim,
    })
    .eq('id', boleto.id)
    .eq('user_id', boleto.user_id)
    .in('status_registro', ['informativo', 'pendente', 'erro']);
  if (boleto.mensagem_erro_registro == null) q = q.is('mensagem_erro_registro', null);
  else q = q.eq('mensagem_erro_registro', boleto.mensagem_erro_registro);
  const { data, error } = await q.select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) {
    const err = new Error('Outra emissão deste boleto já está em andamento. Não enviei outro título ao Sicoob.');
    err.emAndamento = true;
    throw err;
  }
}

async function emitirUmBoleto(admin, userId, boletoId) {
  const { data: boleto, error: bErr } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .single();
  if (bErr || !boleto) throw new Error('Boleto não encontrado.');

  if (boleto.status_registro === 'registrado') {
    return {
      success: true,
      boletoId,
      emitido_agora: false,
      status_registro: 'registrado',
      linha_digitavel: boleto.linha_digitavel,
      codigo_barras: boleto.codigo_barras,
      nosso_numero_banco: boleto.nosso_numero_banco,
      pdf_url: boleto.pdf_url,
      message: 'Boleto já registrado no Sicoob.',
    };
  }

  if (boleto.status_registro === 'pago' || boleto.status_registro === 'baixado') {
    return {
      success: true,
      boletoId,
      emitido_agora: false,
      status_registro: boleto.status_registro,
      message: 'Boleto já liquidado ou baixado. Não emiti outro.',
    };
  }

  if (boleto.nosso_numero_banco) {
    await admin
      .from('boletos_parcela_venda')
      .update({ status_registro: 'registrado', mensagem_erro_registro: null })
      .eq('id', boletoId);
    return {
      success: true,
      boletoId,
      emitido_agora: false,
      status_registro: 'registrado',
      linha_digitavel: boleto.linha_digitavel,
      codigo_barras: boleto.codigo_barras,
      nosso_numero_banco: boleto.nosso_numero_banco,
      pdf_url: boleto.pdf_url,
      message: 'Este carnê já tem nosso número no Sicoob. Não emiti outro.',
    };
  }

  const DEMO_CLIENT_ID = '9b5e603e428cc477a2841e2683c92d21';
  const PROD = {
    client_id: '65892082-96c4-46d3-8033-fa7e87d14a59',
    numero_cliente: 1347780,
    numero_conta_corrente: 10196269,
  };

  let { data: config, error: cErr } = await admin
    .from('config_sicoob')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);

  const clientSalvo = String(config?.client_id ?? '').trim();
  const incompleto =
    !config ||
    !clientSalvo ||
    clientSalvo === DEMO_CLIENT_ID ||
    config.ambiente !== 'producao' ||
    !config.numero_cliente ||
    !config.numero_conta_corrente;
  if (incompleto) {
    const row = {
      user_id: userId,
      ativo: true,
      ambiente: 'producao',
      client_id: clientSalvo && clientSalvo !== DEMO_CLIENT_ID ? clientSalvo : PROD.client_id,
      numero_cliente: config?.numero_cliente || PROD.numero_cliente,
      numero_conta_corrente: config?.numero_conta_corrente || PROD.numero_conta_corrente,
      codigo_modalidade: config?.codigo_modalidade || 1,
      codigo_especie_documento: config?.codigo_especie_documento || 'DM',
      identificacao_emissao_boleto: config?.identificacao_emissao_boleto || 1,
      identificacao_distribuicao_boleto: config?.identificacao_distribuicao_boleto || 1,
      gerar_pix_boleto: Boolean(config?.gerar_pix_boleto),
      webhook_token: config?.webhook_token ?? null,
    };
    const { data: saved, error: upErr } = await admin
      .from('config_sicoob')
      .upsert(row, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (upErr) throw new Error(upErr.message);
    config = saved;
  }

  if (!config?.ativo && config?.ambiente === 'producao' && config?.client_id && config?.numero_cliente) {
    config.ativo = true;
  }
  if (!config?.ativo) {
    return {
      success: true,
      boletoId,
      emitido_agora: false,
      status_registro: 'informativo',
      message: 'Sicoob inativo — carnê informativo mantido.',
    };
  }
  if (!config.client_id?.trim() || !config.numero_cliente || !config.numero_conta_corrente) {
    throw new Error('Configure Client ID, convênio e conta corrente em Configurações › Sicoob.');
  }

  const cert = await resolveCertificadoAtivo(admin, userId, boleto.emitente_id);
  if (!cert) throw new Error('Cadastre o certificado A1 em Configurações › NFS-e (reutilizado pelo Sicoob).');

  const { data: sec } = await admin
    .from('empresa_certificado_secreto')
    .select('senha_criptografada')
    .eq('certificado_id', cert.id)
    .maybeSingle();
  if (!sec?.senha_criptografada) {
    throw new Error('Senha do certificado A1 não encontrada. Reenvie o certificado.');
  }

  const { data: perfil } = await admin.from('perfil_cobranca').select('*').eq('user_id', userId).maybeSingle();
  if (!perfil?.razao_social?.trim() && !String(boleto.beneficiario_razao_social ?? '').trim()) {
    throw new Error('Preencha o perfil do beneficiário em Configurações.');
  }

  const clienteId = await resolveClienteId(admin, boleto);
  if (!clienteId) throw new Error('Não foi possível identificar o cliente do boleto.');

  const { data: cliente, error: cliErr } = await admin.from('clientes').select('*').eq('id', clienteId).single();
  if (cliErr || !cliente) throw new Error(cliErr?.message ?? 'Cliente não encontrado.');

  let notaFiscal = null;
  if (boleto.nota_fiscal_id) {
    const { data } = await admin.from('nota_fiscal').select('numero, codigo_verificacao').eq('id', boleto.nota_fiscal_id).maybeSingle();
    notaFiscal = data;
  } else if (boleto.mensalidade_id) {
    const { data } = await admin
      .from('nota_fiscal')
      .select('id, numero, codigo_verificacao')
      .eq('mensalidade_id', boleto.mensalidade_id)
      .eq('status', 'autorizada')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    notaFiscal = data;
  }

  const certPath = await downloadCertToTemp(admin, cert.storage_path);
  const senha = await decryptCertPassword(admin, sec.senha_criptografada);

  const adotar = async (jaNoBanco, payload, quantidade) => {
    const updateRow = {
      tipo_emissao: 'sicoob',
      status_registro: 'registrado',
      linha_digitavel: jaNoBanco.linhaDigitavel ?? jaNoBanco.linha_digitavel ?? boleto.linha_digitavel,
      codigo_barras: jaNoBanco.codigoBarras ?? jaNoBanco.codigo_barras ?? boleto.codigo_barras,
      nosso_numero_banco:
        jaNoBanco.nossoNumero != null ? String(jaNoBanco.nossoNumero) : boleto.nosso_numero_banco,
      sicoob_seu_numero: jaNoBanco.seuNumero ?? payload.seuNumero,
      data_registro: boleto.data_registro || new Date().toISOString(),
      mensagem_erro_registro: null,
      nota_fiscal_id: notaFiscal?.id ?? boleto.nota_fiscal_id ?? null,
    };
    await admin.from('boletos_parcela_venda').update(updateRow).eq('id', boletoId);
    await registrarAcao(
      admin,
      boletoId,
      userId,
      'EMISSAO',
      quantidade > 1
        ? `Havia ${quantidade} títulos com este seu número. Gravei o nosso número maior e não emiti outro.`
        : 'Boleto já existia no Sicoob (seu número). Carnê atualizado sem emitir outro.',
      jaNoBanco,
    );
    return {
      success: true,
      boletoId,
      emitido_agora: false,
      status_registro: 'registrado',
      linha_digitavel: updateRow.linha_digitavel,
      codigo_barras: updateRow.codigo_barras,
      nosso_numero_banco: updateRow.nosso_numero_banco,
      pdf_url: boleto.pdf_url,
      message: 'Este boleto já estava no Sicoob. Atualizei o carnê e não emiti outro.',
    };
  };

  let reservou = false;
  let postIniciado = false;

  try {
    const payload = buildSicoobPayload({
      boleto,
      config,
      cliente,
      notaFiscal,
      beneficiarioDocumento: boleto.beneficiario_documento || perfil?.documento,
    });

    const buscaArgs = {
      config,
      certPath,
      senha,
      cliente,
      seuNumero: payload.seuNumero,
      vencimento: boleto.data_vencimento,
    };

    const ultima = tentativaIncerta(await acoesEmissao(admin, boletoId));
    if (ultima) {
      const busca = await acharBoletosJaEmitidos(buscaArgs);
      if (busca.boletos.length) return await adotar(busca.boletos[0], payload, busca.boletos.length);
      const idade = Date.now() - new Date(ultima.criado_em).getTime();
      const recente = idade < 3 * 60 * 1000;
      if (recente || !busca.consultaOk) {
        const msg = recente
          ? 'Emissão deste boleto ainda pode estar em andamento no Sicoob. Aguarde alguns minutos. Não enviei outro título.'
          : 'Não emiti outro boleto. Uma tentativa anterior pode ter sido aceita pelo Sicoob e a consulta não confirmou. Confira no banco antes de tentar de novo.';
        await admin
          .from('boletos_parcela_venda')
          .update({ tipo_emissao: 'sicoob', status_registro: 'erro', mensagem_erro_registro: msg })
          .eq('id', boletoId);
        throw new Error(msg);
      }
      await registrarAcao(
        admin,
        boletoId,
        userId,
        'CONSULTA_SEM_TITULO',
        'Consulta do pagador não achou título em aberto com este seu número. Nova emissão liberada.',
      );
    }

    await recusarSegundoBoletoNoDia(admin, userId, boleto, clienteId);

    await reivindicarEmissao(admin, boleto);
    reservou = true;

    const buscaAntes = await acharBoletosJaEmitidos(buscaArgs);
    if (buscaAntes.boletos.length) return await adotar(buscaAntes.boletos[0], payload, buscaAntes.boletos.length);

    await registrarAcao(
      admin,
      boletoId,
      userId,
      'TENTATIVA_EMISSAO',
      'Enviando registro ao Sicoob. Se esta chamada cair, a próxima não emite outro título sem confirmar no banco.',
    );
    postIniciado = true;

    const sicoob = await emitirBoletoSicoobApi({
      config,
      certPath,
      senha,
      payload,
      ambiente: config.ambiente,
    });

    let pdfStoragePath = null;
    let pdfUrl = null;
    if (sicoob.pdf_base64) {
      const pdfBuffer = Buffer.from(sicoob.pdf_base64, 'base64');
      pdfStoragePath = `${userId}/boletos/${boletoId}.pdf`;
      const { error: upErr } = await admin.storage
        .from('boletos_sicoob')
        .upload(pdfStoragePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
      if (!upErr) {
        const { data: signed } = await admin.storage.from('boletos_sicoob').createSignedUrl(pdfStoragePath, 60 * 60 * 24 * 30);
        pdfUrl = signed?.signedUrl ?? null;
      }
    }

    const updateRow = {
      tipo_emissao: 'sicoob',
      status_registro: 'registrado',
      linha_digitavel: sicoob.linha_digitavel,
      codigo_barras: sicoob.codigo_barras,
      nosso_numero_banco: sicoob.nosso_numero_banco,
      sicoob_seu_numero: sicoob.seu_numero,
      pdf_storage_path: pdfStoragePath,
      pdf_url: pdfUrl,
      data_registro: new Date().toISOString(),
      mensagem_erro_registro: null,
      nota_fiscal_id: notaFiscal?.id ?? boleto.nota_fiscal_id ?? null,
    };

    await admin.from('boletos_parcela_venda').update(updateRow).eq('id', boletoId);
    await registrarAcao(admin, boletoId, userId, 'EMISSAO', 'Boleto registrado via API Sicoob V3.', sicoob.raw ?? null);

    return {
      success: true,
      boletoId,
      emitido_agora: true,
      status_registro: 'registrado',
      linha_digitavel: sicoob.linha_digitavel,
      codigo_barras: sicoob.codigo_barras,
      nosso_numero_banco: sicoob.nosso_numero_banco,
      pdf_url: pdfUrl,
      message: 'Boleto registrado no Sicoob.',
    };
  } catch (error) {
    const msg = error?.message ?? 'Falha na emissão Sicoob.';
    if (!reservou) throw new Error(msg);
    const recusou = Boolean(error?.bancoRecusou);
    const texto = recusou || !postIniciado
      ? msg
      : `${msg} Não gere de novo sem conferir no Sicoob: o banco pode ter aceito este título.`;
    if (recusou) {
      await registrarAcao(admin, boletoId, userId, 'EMISSAO_RECUSADA', msg);
    } else if (postIniciado) {
      await registrarAcao(admin, boletoId, userId, 'ERRO', texto);
    }
    await admin
      .from('boletos_parcela_venda')
      .update({
        tipo_emissao: 'sicoob',
        status_registro: 'erro',
        mensagem_erro_registro: texto,
      })
      .eq('id', boletoId);
    throw new Error(texto);
  } finally {
    cleanupCert(certPath);
  }
}

module.exports = { emitirUmBoleto };
