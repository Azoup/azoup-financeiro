const { createNfeWizard, cleanupCert } = require('./nfeCancel');

async function emitirNfeSefaz({ admin, nota, itens, pagamentos, perfil, cliente, config, cert, senhaEnc }) {
  const layout = buildNFeLayout({ nota, itens, pagamentos, perfil, cliente, config });
  const { wizard, certPath } = await createNfeWizard({
    admin,
    cert,
    senhaEnc,
    ambiente: nota.ambiente,
  });

  try {
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
    cleanupCert(certPath);
  }
}

module.exports = { emitirNfeSefaz };
