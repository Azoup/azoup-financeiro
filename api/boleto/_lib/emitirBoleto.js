const { getAdmin, getUserFromBearer } = require('../../nfe/_lib/supabaseAdmin');
const { decryptCertPassword } = require('../../nfe/_lib/crypto');
const { resolveCertificadoAtivo } = require('./sicoobCredentials');
const {
  buildSicoobPayload,
  cleanupCert,
  downloadCertToTemp,
  emitirBoletoSicoobApi,
} = require('./sicoobClient');

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
  if (!perfil?.razao_social?.trim()) {
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

  await admin
    .from('boletos_parcela_venda')
    .update({
      tipo_emissao: 'sicoob',
      status_registro: 'pendente',
      mensagem_erro_registro: null,
    })
    .eq('id', boletoId);

  const certPath = await downloadCertToTemp(admin, cert.storage_path);
  const senha = await decryptCertPassword(admin, sec.senha_criptografada);

  try {
    const payload = buildSicoobPayload({
      boleto,
      config,
      cliente,
      notaFiscal,
      beneficiarioDocumento: boleto.beneficiario_documento || perfil?.documento,
    });
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
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boletoId,
      acao: 'EMISSAO',
      usuario_id: userId,
      detalhes: 'Boleto registrado via API Sicoob V3.',
      payload_resposta: sicoob.raw ?? null,
    });

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
    await admin
      .from('boletos_parcela_venda')
      .update({
        tipo_emissao: 'sicoob',
        status_registro: 'erro',
        mensagem_erro_registro: msg,
      })
      .eq('id', boletoId);
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boletoId,
      acao: 'ERRO',
      usuario_id: userId,
      detalhes: msg,
    });
    throw new Error(msg);
  } finally {
    cleanupCert(certPath);
  }
}

module.exports = { emitirUmBoleto };
