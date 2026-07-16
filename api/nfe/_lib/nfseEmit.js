const { buildNFSeLayout } = require('./buildNFSeFromDb');
const { createNfseWizard, cleanupCert, downloadCertToTemp } = require('./nfseWizard');
const { decryptCertPassword } = require('./crypto');
const { withHomologTlsRelaxed } = require('./tlsHomolog');
const { humanizeNfseRejection, validarConvenioMunicipio } = require('./nfseErrors');
const { installMunicipalAxiosRedirect } = require('./municipalAxiosRedirect');
const { resolveNfseGateway } = require('./nfseGateways');
const { emitirNfsePaulistana } = require('./nfsePaulistana');
const { emitirNfseAbrasfAmericana } = require('./nfseAbrasfAmericana');
const { prepareServerlessCryptoEnv } = require('./serverlessEnv');

function extrairXml(ret) {
  const xml =
    ret?.response?.xml ??
    ret?.response?.xmlNFSe ??
    ret?.xml ??
    ret?.response?.nfseProc ??
    null;
  if (typeof xml === 'string') return xml;
  if (xml) return JSON.stringify(xml);
  return null;
}

async function emitirNfseSefaz({ admin, nota, itens, perfil, cliente, config, cert, senhaEnc }) {
  const ambiente = 1; // produção
  const gateway = resolveNfseGateway(config.codigo_ibge_emitente, ambiente);

  // São Paulo capital → WebService Paulistana
  if (gateway.mode === 'paulistana') {
    prepareServerlessCryptoEnv();
    const senha = await decryptCertPassword(admin, senhaEnc);
    const certPath = await downloadCertToTemp(admin, cert.storage_path);
    try {
      console.info('[nfse] gateway Paulistana', gateway.nome);
      const result = await withHomologTlsRelaxed(() =>
        emitirNfsePaulistana({
          certPath,
          senha,
          nota,
          itens,
          perfil,
          cliente,
          config,
          ambiente,
        }),
      );
      if (!result.success && result.message) {
        result.message = humanizeNfseRejection(result.message, config.codigo_ibge_emitente);
      }
      return result;
    } catch (e) {
      return {
        success: false,
        status: 'ERR',
        message: humanizeNfseRejection(e?.message ?? String(e), config.codigo_ibge_emitente),
      };
    } finally {
      cleanupCert(certPath);
    }
  }

  // Americana → ABRASF TipLan (mesmo canal típico do Delphi)
  if (gateway.mode === 'abrasf') {
    prepareServerlessCryptoEnv();
    const senha = await decryptCertPassword(admin, senhaEnc);
    const certPath = await downloadCertToTemp(admin, cert.storage_path);
    try {
      console.info('[nfse] gateway ABRASF', gateway.nome);
      const result = await withHomologTlsRelaxed(() =>
        emitirNfseAbrasfAmericana({
          certPath,
          senha,
          nota,
          itens,
          perfil,
          cliente,
          config,
          ambiente,
        }),
      );
      if (!result.success && result.message) {
        result.message = humanizeNfseRejection(result.message, config.codigo_ibge_emitente);
      }
      return result;
    } catch (e) {
      return {
        success: false,
        status: 'ERR',
        message: humanizeNfseRejection(e?.message ?? String(e), config.codigo_ibge_emitente),
      };
    } finally {
      cleanupCert(certPath);
    }
  }

  const layout = buildNFSeLayout({ nota, itens, perfil, cliente, config });

  return withHomologTlsRelaxed(async () => {
    const { wizard, certPath, gateway: gw } = await createNfseWizard({
      admin,
      cert,
      senhaEnc,
      perfil,
      ambiente,
      ibge: config.codigo_ibge_emitente,
    });

    try {
      if (!gw.skipConvenioNacional) {
        const convenio = await validarConvenioMunicipio(wizard, config.codigo_ibge_emitente);
        if (!convenio.ok) {
          return {
            success: false,
            status: 'E0039',
            message: convenio.message,
          };
        }
      }

      let ret;
      let removeRedirect = () => undefined;
      try {
        if (gw.mode === 'municipal' && gw.urlOverrides) {
          removeRedirect = await installMunicipalAxiosRedirect(wizard, gw.urlOverrides);
          console.info('[nfse] gateway municipal', gw.nome, gw.urlOverrides.NFSe_Autorizacao);
        }
        ret = await wizard.Autorizacao(layout);
      } catch (authErr) {
        const raw = authErr?.message ?? String(authErr) ?? 'Falha ao comunicar com o webservice NFS-e.';
        const hint =
          gw.mode === 'municipal' &&
          !/L327|L906|L2103|E0039|E0314|E314|TSDec15V2|vTotTribMun/i.test(raw)
            ? ' Verifique se o CNPJ tem Autorização para Emissão em nfse.americana.sp.gov.br.'
            : '';
        return {
          success: false,
          status: 'ERR',
          message: `${humanizeNfseRejection(raw, config.codigo_ibge_emitente)}${hint}`,
        };
      } finally {
        removeRedirect();
      }
      const chave =
        ret?.response?.chaveAcesso ??
        ret?.response?.chNFSe ??
        ret?.chaveAcesso ??
        ret?.chNFSe ??
        null;
      const protocolo =
        ret?.response?.nProt ??
        ret?.response?.protocolo ??
        ret?.nProt ??
        ret?.protocolo ??
        null;
      const codigoVerificacao = ret?.response?.codigoVerificacao ?? ret?.codigoVerificacao ?? null;
      const status = String(ret?.status ?? ret?.response?.status ?? ret?.cStat ?? '');
      const message =
        ret?.response?.message ??
        ret?.response?.xMotivo ??
        ret?.message ??
        ret?.xMotivo ??
        'Autorizada';

      const ok =
        ret?.success === true ||
        status === '100' ||
        status === 'OK' ||
        status.toLowerCase() === 'sucesso' ||
        Boolean(chave);

      if (!ok) {
        return {
          success: false,
          status,
          message: humanizeNfseRejection(message, config.codigo_ibge_emitente),
        };
      }

      const xmlProc = extrairXml(ret);
      let danfeUrl = null;
      let danfePath = null;

      if (xmlProc && chave) {
        try {
          const danfeMod = await import('@nfewizard/danfe');
          const gerar = danfeMod.NFSE_GerarDanfe ?? danfeMod.default?.NFSE_GerarDanfe;
          if (typeof gerar === 'function') {
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            const tmpPdf = path.join(os.tmpdir(), `danfse-${Date.now()}.pdf`);
            await gerar({
              data: ret?.response ?? ret,
              chave,
              outputPath: tmpPdf,
            });
            const pdfBuffer = fs.readFileSync(tmpPdf);
            danfePath = `${nota.user_id}/${chave}.pdf`;
            const { error: upErr } = await admin.storage
              .from('nota_fiscal_danfe')
              .upload(danfePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
            if (!upErr) {
              const { data: pub } = admin.storage.from('nota_fiscal_danfe').getPublicUrl(danfePath);
              danfeUrl = pub.publicUrl;
            }
            try {
              fs.unlinkSync(tmpPdf);
            } catch {
              /* ignore */
            }
          }
        } catch (danfeErr) {
          console.warn('DANFSe PDF:', danfeErr.message);
        }
      }

      return {
        success: true,
        status: status || '100',
        chave_acesso: chave,
        protocolo_autorizacao: protocolo,
        codigo_verificacao: codigoVerificacao,
        xml_autorizado: xmlProc,
        danfe_url: danfeUrl,
        danfe_storage_path: danfePath,
        message,
      };
    } finally {
      cleanupCert(certPath);
    }
  });
}

module.exports = { emitirNfseSefaz };
