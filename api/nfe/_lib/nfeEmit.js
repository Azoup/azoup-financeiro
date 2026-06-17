const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildNFeLayout } = require('./buildNFeFromDb');
const { decrypt } = require('./crypto');

async function loadNfeWizard() {
  try {
    const mod = await import('nfewizard-io');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function downloadCertToTemp(admin, storagePath) {
  const { data, error } = await admin.storage.from('empresa_certificados').download(storagePath);
  if (error || !data) throw new Error('Não foi possível baixar o certificado A1.');
  const tmp = path.join(os.tmpdir(), `cert-${Date.now()}.pfx`);
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  return tmp;
}

async function emitirNfeSefaz({ admin, nota, itens, pagamentos, perfil, cliente, config, cert, senhaEnc }) {
  const NFeWizard = await loadNfeWizard();
  if (!NFeWizard) {
    throw new Error(
      'Pacote nfewizard-io não instalado no servidor. Rode npm install nfewizard-io @nfewizard/danfe na Vercel.',
    );
  }

  const layout = buildNFeLayout({ nota, itens, pagamentos, perfil, cliente, config });
  const senha = decrypt(senhaEnc);
  const certPath = await downloadCertToTemp(admin, cert.storage_path);

  try {
    const wizard = new NFeWizard();
    await wizard.NFE_LoadEnvironment({
      config: {
        dfe: {
          pathCertificado: certPath,
          senhaCertificado: senha,
        },
        nfe: {
          ambiente: Number(nota.ambiente),
        },
      },
    });

    const signed = await wizard.NFE_Assinar(layout);
    const auth = await wizard.NFE_Autorizacao(signed, { indSinc: 1 });

    const cStat = String(auth?.cStat ?? auth?.protNFe?.infProt?.cStat ?? '');
    const xMotivo = auth?.xMotivo ?? auth?.protNFe?.infProt?.xMotivo ?? 'Sem retorno SEFAZ';
    const chave = auth?.chNFe ?? auth?.protNFe?.infProt?.chNFe ?? null;
    const protocolo = auth?.nProt ?? auth?.protNFe?.infProt?.nProt ?? null;
    const xmlProc = auth?.xml ?? auth?.nfeProc ?? null;

    if (cStat !== '100') {
      return { success: false, status: cStat, message: xMotivo };
    }

    let danfeUrl = null;
    let danfePath = null;

    try {
      const danfeMod = await import('@nfewizard/danfe');
      const Danfe = danfeMod.default ?? danfeMod.Danfe ?? danfeMod;
      const pdfBuffer = await Danfe.generate({ xml: xmlProc });
      danfePath = `${nota.user_id}/${chave}.pdf`;
      const { error: upErr } = await admin.storage
        .from('nota_fiscal_danfe')
        .upload(danfePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
      if (!upErr) {
        const { data: pub } = admin.storage.from('nota_fiscal_danfe').getPublicUrl(danfePath);
        danfeUrl = pub.publicUrl;
      }
    } catch (danfeErr) {
      console.warn('DANFE PDF:', danfeErr.message);
    }

    return {
      success: true,
      status: cStat,
      chave_acesso: chave,
      protocolo_autorizacao: protocolo,
      xml_autorizado: typeof xmlProc === 'string' ? xmlProc : JSON.stringify(xmlProc),
      danfe_url: danfeUrl,
      danfe_storage_path: danfePath,
      message: xMotivo,
    };
  } finally {
    try {
      fs.unlinkSync(certPath);
    } catch {
      /* ignore */
    }
  }
}

module.exports = { emitirNfeSefaz };
