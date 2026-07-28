const {
  buildC6Payload,
  cleanupTemp,
  emitirBoletoC6Api,
  obterPdfBoletoC6Api,
} = require('./c6Client');
const { loadC6Credentials } = require('./c6Credentials');

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

async function emitirUmBoletoC6(admin, userId, boletoId, emitenteIdHint) {
  const { data: boleto, error: bErr } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .single();
  if (bErr || !boleto) throw new Error('Boleto não encontrado.');

  if (boleto.status_registro === 'registrado' && boleto.tipo_emissao === 'c6') {
    return {
      success: true,
      boletoId,
      status_registro: 'registrado',
      linha_digitavel: boleto.linha_digitavel,
      codigo_barras: boleto.codigo_barras,
      nosso_numero_banco: boleto.nosso_numero_banco,
      c6_boleto_id: boleto.c6_boleto_id,
      pdf_url: boleto.pdf_url,
      message: 'Boleto já registrado no C6.',
    };
  }

  const emitenteId = emitenteIdHint || boleto.emitente_id;
  if (!emitenteId) {
    throw new Error('Emitente (CNPJ) não informado para emissão C6.');
  }

  const creds = await loadC6Credentials(admin, userId, emitenteId);
  if (!creds) {
    return {
      success: true,
      boletoId,
      status_registro: 'informativo',
      message: 'C6 inativo — carnê informativo mantido.',
    };
  }

  const clienteId = await resolveClienteId(admin, boleto);
  if (!clienteId) throw new Error('Não foi possível identificar o cliente do boleto.');

  const { data: cliente, error: cliErr } = await admin.from('clientes').select('*').eq('id', clienteId).single();
  if (cliErr || !cliente) throw new Error(cliErr?.message ?? 'Cliente não encontrado.');

  await admin
    .from('boletos_parcela_venda')
    .update({
      tipo_emissao: 'c6',
      emitente_id: emitenteId,
      status_registro: 'pendente',
      mensagem_erro_registro: null,
    })
    .eq('id', boletoId);

  try {
    const payload = buildC6Payload({ boleto, config: creds.config, cliente });
    const c6 = await emitirBoletoC6Api({
      config: creds.config,
      certPath: creds.certPath,
      keyPath: creds.keyPath,
      payload,
    });

    if (!c6.id) {
      throw new Error('C6 não retornou o ID do boleto.');
    }

    let pdfStoragePath = null;
    let pdfUrl = null;
    try {
      const pdfBuffer = await obterPdfBoletoC6Api({
        config: creds.config,
        certPath: creds.certPath,
        keyPath: creds.keyPath,
        c6BoletoId: c6.id,
      });
      pdfStoragePath = `${userId}/boletos/${boletoId}.pdf`;
      const { error: upErr } = await admin.storage
        .from('boletos_c6')
        .upload(pdfStoragePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
      if (!upErr) {
        const { data: signed } = await admin.storage
          .from('boletos_c6')
          .createSignedUrl(pdfStoragePath, 60 * 60 * 24 * 30);
        pdfUrl = signed?.signedUrl ?? null;
      }
    } catch {
      // PDF pode ficar pendente; linha digitável já basta.
    }

    const updateRow = {
      tipo_emissao: 'c6',
      emitente_id: emitenteId,
      status_registro: 'registrado',
      linha_digitavel: c6.linha_digitavel,
      codigo_barras: c6.codigo_barras,
      nosso_numero_banco: c6.nosso_numero_banco,
      c6_boleto_id: c6.id,
      c6_external_id: payload.external_reference_id,
      pdf_storage_path: pdfStoragePath,
      pdf_url: pdfUrl,
      data_registro: new Date().toISOString(),
      mensagem_erro_registro: null,
    };

    await admin.from('boletos_parcela_venda').update(updateRow).eq('id', boletoId);
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boletoId,
      acao: 'EMISSAO',
      usuario_id: userId,
      detalhes: 'Boleto registrado via API C6 Bank.',
      payload_resposta: c6.raw ?? null,
    });

    return {
      success: true,
      boletoId,
      status_registro: 'registrado',
      linha_digitavel: c6.linha_digitavel,
      codigo_barras: c6.codigo_barras,
      nosso_numero_banco: c6.nosso_numero_banco,
      c6_boleto_id: c6.id,
      pdf_url: pdfUrl,
      message: 'Boleto registrado no C6.',
    };
  } catch (error) {
    const msg = error?.message ?? 'Falha na emissão C6.';
    await admin
      .from('boletos_parcela_venda')
      .update({
        tipo_emissao: 'c6',
        emitente_id: emitenteId,
        status_registro: 'erro',
        mensagem_erro_registro: msg,
      })
      .eq('id', boletoId);
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boletoId,
      acao: 'ERRO',
      usuario_id: userId,
      detalhes: `[C6] ${msg}`,
    });
    throw new Error(msg);
  } finally {
    if (!creds.bundled) {
      cleanupTemp(creds.certPath);
      cleanupTemp(creds.keyPath);
    }
  }
}

module.exports = { emitirUmBoletoC6 };
