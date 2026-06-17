const { getAdmin, getUserFromBearer } = require('./_lib/supabaseAdmin');
const { encrypt } = require('./_lib/crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  try {
    const user = await getUserFromBearer(req);
    const { certificadoId, senha } = req.body ?? {};
    if (!certificadoId || !senha) {
      return res.status(400).json({ error: 'certificadoId e senha são obrigatórios.' });
    }

    const admin = getAdmin();
    const { data: cert, error } = await admin
      .from('empresa_certificado')
      .select('id, user_id')
      .eq('id', certificadoId)
      .eq('user_id', user.id)
      .single();
    if (error || !cert) {
      return res.status(404).json({ error: 'Certificado não encontrado.' });
    }

    const senhaCriptografada = encrypt(String(senha));

    const { error: secErr } = await admin.from('empresa_certificado_secreto').upsert(
      { certificado_id: certificadoId, senha_criptografada: senhaCriptografada },
      { onConflict: 'certificado_id' },
    );
    if (secErr) throw new Error(secErr.message);

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: (e).message ?? 'Erro ao salvar senha do certificado.' });
  }
};
