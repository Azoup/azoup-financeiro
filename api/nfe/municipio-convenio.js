const { getAdmin, getUserFromBearer } = require('./_lib/supabaseAdmin');
const { createNfseWizard, cleanupCert } = require('./_lib/nfseWizard');
const { withHomologTlsRelaxed } = require('./_lib/tlsHomolog');
const { validarConvenioMunicipio } = require('./_lib/nfseErrors');
const { prepareServerlessCryptoEnv } = require('./_lib/serverlessEnv');

prepareServerlessCryptoEnv();

/** GET /api/nfe/municipio-convenio?ibge=3550308 — verifica adesão ao emissor nacional (homologação). */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Use GET.' });
  }

  const ibge = String(req.query?.ibge ?? '').trim();
  if (!ibge) {
    return res.status(400).json({ ok: false, message: 'Informe ?ibge= com 7 dígitos.' });
  }

  try {
    const user = await getUserFromBearer(req);
    const admin = getAdmin();

    const [{ data: perfil }, { data: cert }] = await Promise.all([
      admin.from('perfil_cobranca').select('*').eq('user_id', user.id).maybeSingle(),
      admin.from('empresa_certificado').select('*').eq('user_id', user.id).eq('ativo', true).maybeSingle(),
    ]);

    if (!perfil?.documento) {
      return res.status(400).json({ ok: false, message: 'Preencha o prestador em Configurações › NFS-e.' });
    }
    if (!cert) {
      return res.status(400).json({ ok: false, message: 'Envie o certificado A1 antes de consultar o município.' });
    }

    const { data: sec } = await admin
      .from('empresa_certificado_secreto')
      .select('senha_criptografada')
      .eq('certificado_id', cert.id)
      .maybeSingle();
    if (!sec?.senha_criptografada) {
      return res.status(400).json({ ok: false, message: 'Senha do certificado não encontrada. Reenvie o .pfx.' });
    }

    const result = await withHomologTlsRelaxed(async () => {
      const { wizard, certPath } = await createNfseWizard({
        admin,
        cert,
        senhaEnc: sec.senha_criptografada,
        perfil,
        ambiente: 2,
      });
      try {
        return await validarConvenioMunicipio(wizard, ibge);
      } finally {
        cleanupCert(certPath);
      }
    });

    return res.status(result.ok ? 200 : 422).json(result);
  } catch (e) {
    console.error('nfe/municipio-convenio', e);
    return res.status(500).json({
      ok: false,
      message: (e && e.message) || 'Falha ao consultar convênio municipal.',
    });
  }
};
