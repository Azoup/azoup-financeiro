const { getAdmin, getUserFromBearer } = require('../../nfe/_lib/supabaseAdmin');
const { decryptCertPassword } = require('../../nfe/_lib/crypto');
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
      status_registro: 'registrado',
      linha_digitavel: boleto.linha_digitavel,
      codigo_barras: boleto.codigo_barras,
      nosso_numero_banco: boleto.nosso_numero_banco,
      pdf_url: boleto.pdf_url,
      message: 'Boleto já registrado no Sicoob.',
    };
  }

  const { data: config, error: cErr } = await admin
    .from('config_sicoob')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!config?.ativo) {
    return {
      success: true,
      boletoId,
      status_registro: 'informativo',
      message: 'Sicoob inativo — carnê informativo mantido.',
    };
  }
  if (!config.client_id?.trim() || !config.numero_cliente) {
    throw new Error('Configure Client ID e número do cliente (convênio) em Configurações › Sicoob.');
  }

  const [{ data: cert }, { data: sec }] = await Promise.all([
    admin.from('empresa_certificado').select('*').eq('user_id', userId).eq('ativo', true).maybeSingle(),
    admin
      .from('empresa_certificado')
      .select('id')
      .eq('user_id', userId)
      .eq('ativo', true)
      .maybeSingle()
      .then(async ({ data: c }) => {
        if (!c?.id) return { data: null };
        return admin
          .from('empresa_certificado_secreto')
          .select('senha_criptografada')
          .eq('certificado_id', c.id)
          .maybeSingle();
      }),
  ]);

  if (!cert) throw new Error('Cadastre o certificado A1 em Configurações › NFS-e (reutilizado pelo Sicoob).');
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
    const payload = buildSicoobPayload({ boleto, config, cliente, notaFiscal });
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
