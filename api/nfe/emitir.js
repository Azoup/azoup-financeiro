const { getAdmin, getUserFromBearer } = require('./_lib/supabaseAdmin');
const { emitirNfseSefaz } = require('./_lib/nfseEmit');
const { prepareServerlessCryptoEnv } = require('./_lib/serverlessEnv');
const { resolveEmitenteContexto } = require('./_lib/nfseEmitenteResolve');

prepareServerlessCryptoEnv();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const notaFiscalId = req.body?.notaFiscalId;

  try {
    const user = await getUserFromBearer(req);
    if (!notaFiscalId) {
      return res.status(400).json({ success: false, message: 'notaFiscalId é obrigatório.' });
    }

    const admin = getAdmin();

    const { data: nota, error: nErr } = await admin
      .from('nota_fiscal')
      .select('*')
      .eq('id', notaFiscalId)
      .eq('user_id', user.id)
      .single();
    if (nErr || !nota) {
      return res.status(404).json({ success: false, message: 'Nota fiscal não encontrada.' });
    }
    if (nota.status === 'autorizada') {
      return res.status(200).json({
        success: true,
        status: nota.status_sefaz ?? '100',
        chave_acesso: nota.chave_acesso,
        danfe_url: nota.danfe_url,
        message: 'NFS-e já autorizada.',
      });
    }

    const [{ data: itens }, { data: pagamentos }, { data: cliente }, emitCtx] = await Promise.all([
      admin.from('nota_fiscal_item').select('*').eq('nota_fiscal_id', notaFiscalId),
      admin.from('nota_fiscal_pagamento').select('*').eq('nota_fiscal_id', notaFiscalId),
      admin.from('clientes').select('*').eq('id', nota.cliente_id).single(),
      resolveEmitenteContexto(admin, user.id, nota),
    ]);

    const { perfil, config, cert } = emitCtx;

    if (!perfil?.razao_social) {
      throw new Error('Preencha o emitente (CNPJ) em Configurações › NFS-e.');
    }
    if (!config?.codigo_ibge_emitente) {
      throw new Error('Informe o código IBGE do município do prestador em Configurações › NFS-e.');
    }
    if (!cert) {
      throw new Error('Cadastre o certificado A1 do emitente escolhido em Configurações › NFS-e.');
    }
    if (!itens?.length) {
      throw new Error('Nota sem itens fiscais.');
    }

    const { data: sec } = await admin
      .from('empresa_certificado_secreto')
      .select('senha_criptografada')
      .eq('certificado_id', cert.id)
      .maybeSingle();
    if (!sec?.senha_criptografada) {
      throw new Error('Senha do certificado não encontrada. Reenvie o certificado A1.');
    }

    const result = await emitirNfseSefaz({
      admin,
      nota,
      itens,
      pagamentos: pagamentos ?? [],
      perfil,
      cliente,
      config,
      cert,
      senhaEnc: sec.senha_criptografada,
    });

    if (!result.success) {
      await admin
        .from('nota_fiscal')
        .update({
          status: 'rejeitada',
          status_sefaz: result.status ?? null,
          motivo_rejeicao: result.message ?? 'Rejeitada pela prefeitura/SEFIN',
        })
        .eq('id', notaFiscalId);
      return res.status(422).json(result);
    }

    await admin
      .from('nota_fiscal')
      .update({
        status: 'autorizada',
        status_sefaz: result.status,
        chave_acesso: result.chave_acesso,
        protocolo_autorizacao: result.protocolo_autorizacao,
        xml_autorizado: result.xml_autorizado,
        danfe_url: result.danfe_url,
        danfe_storage_path: result.danfe_storage_path,
        codigo_verificacao: result.codigo_verificacao ?? null,
        tipo_documento: 'nfse',
        ambiente: 1,
        motivo_rejeicao: null,
        emitente_id: nota.emitente_id || emitCtx.emitente?.id || null,
      })
      .eq('id', notaFiscalId);

    return res.status(200).json(result);
  } catch (e) {
    console.error('nfe/emitir', e);
    const msg =
      (e && typeof e === 'object' && 'message' in e && e.message) ||
      (typeof e === 'string' ? e : '') ||
      'Falha na emissão NFS-e.';
    return res.status(500).json({ success: false, message: String(msg) });
  }
};
