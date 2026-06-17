const { getAdmin, getUserFromBearer } = require('./_lib/supabaseAdmin');
const { cancelarNfseSefaz } = require('./_lib/nfseCancel');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const user = await getUserFromBearer(req);
    const { notaFiscalId, justificativa } = req.body ?? {};
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
    if (nota.status === 'cancelada') {
      return res.status(200).json({ success: true, message: 'NFS-e já cancelada.' });
    }
    if (nota.status !== 'autorizada') {
      return res.status(400).json({
        success: false,
        message: 'Só é possível cancelar NFS-e autorizada.',
      });
    }

    const [{ data: perfil }, { data: cert }] = await Promise.all([
      admin.from('perfil_cobranca').select('*').eq('user_id', user.id).maybeSingle(),
      admin.from('empresa_certificado').select('*').eq('user_id', user.id).eq('ativo', true).maybeSingle(),
    ]);

    if (!perfil?.documento) {
      throw new Error('Emitente não configurado.');
    }
    if (!cert) {
      throw new Error('Certificado A1 não encontrado.');
    }

    const { data: sec } = await admin
      .from('empresa_certificado_secreto')
      .select('senha_criptografada')
      .eq('certificado_id', cert.id)
      .maybeSingle();
    if (!sec?.senha_criptografada) {
      throw new Error('Senha do certificado não encontrada.');
    }

    const result = await cancelarNfseSefaz({
      admin,
      nota,
      perfil,
      cert,
      senhaEnc: sec.senha_criptografada,
      justificativa,
    });

    if (!result.success) {
      return res.status(422).json(result);
    }

    await admin
      .from('nota_fiscal')
      .update({
        status: 'cancelada',
        status_sefaz: result.status,
        motivo_cancelamento: String(justificativa ?? '').trim(),
        data_cancelamento: new Date().toISOString(),
      })
      .eq('id', notaFiscalId);

    return res.status(200).json(result);
  } catch (e) {
    console.error('nfe/cancelar', e);
    return res.status(500).json({
      success: false,
      message: e.message ?? 'Falha ao cancelar NFS-e.',
    });
  }
};
