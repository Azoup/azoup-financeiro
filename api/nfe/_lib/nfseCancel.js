const { createNfseWizard, cleanupCert, onlyDigits, downloadCertToTemp } = require('./nfseWizard');
const { decryptCertPassword } = require('./crypto');
const { withHomologTlsRelaxed } = require('./tlsHomolog');
const { installMunicipalAxiosRedirect } = require('./municipalAxiosRedirect');
const { resolveNfseGateway } = require('./nfseGateways');
const { cancelarNfseAbrasfAmericana } = require('./nfseAbrasfAmericana');

async function cancelarNfseSefaz({
  admin,
  nota,
  perfil,
  cert,
  senhaEnc,
  justificativa,
  codigoIbgeEmitente,
  inscricaoMunicipal,
}) {
  const xJust = String(justificativa ?? '').trim();
  if (xJust.length < 15) {
    throw new Error('A justificativa de cancelamento deve ter no mínimo 15 caracteres.');
  }
  if (!nota.chave_acesso && !nota.codigo_verificacao && !nota.protocolo_autorizacao) {
    throw new Error('Nota sem chave/código de verificação para cancelar.');
  }

  const ambiente = Number(nota.ambiente) === 2 ? 2 : 1;
  const gateway = resolveNfseGateway(codigoIbgeEmitente, ambiente);

  // Americana ABRASF
  if (gateway.mode === 'abrasf') {
    const senha = await decryptCertPassword(admin, senhaEnc);
    const certPath = await downloadCertToTemp(admin, cert.storage_path);
    try {
      return await withHomologTlsRelaxed(() =>
        cancelarNfseAbrasfAmericana({
          certPath,
          senha,
          nota,
          perfil,
          config: {
            inscricao_municipal:
              inscricaoMunicipal || perfil.inscricao_municipal || '',
          },
          justificativa: xJust,
          ambiente,
        }),
      );
    } finally {
      cleanupCert(certPath);
    }
  }

  const chave = onlyDigits(nota.chave_acesso);
  const doc = onlyDigits(perfil.documento);
  const isCnpj = doc.length === 14;

  const evento = {
    pedRegEvento: {
      versao: '1.00',
      infPedReg: {
        tpAmb: ambiente,
        verAplic: 'SistemaJessica-1.0',
        ...(isCnpj ? { CNPJAutor: doc } : { CPFAutor: doc }),
        chNFSe: chave,
        tpEvento: '101101',
        nPedRegEvento: '1',
        e101101: {
          xDesc: 'Cancelamento de NFS-e',
          cMotivo: 1,
          xMotivo: xJust,
        },
      },
    },
  };

  return withHomologTlsRelaxed(async () => {
    const { wizard, certPath } = await createNfseWizard({
      admin,
      cert,
      senhaEnc,
      perfil,
      ambiente,
      ibge: codigoIbgeEmitente,
    });

    let removeRedirect = () => undefined;
    try {
      if (typeof wizard.RegistrarEvento !== 'function') {
        throw new Error('Cancelamento NFS-e não disponível nesta versão da biblioteca.');
      }

      if (gateway.mode === 'municipal' && gateway.urlOverrides) {
        removeRedirect = await installMunicipalAxiosRedirect(wizard, gateway.urlOverrides);
      }

      const ret = await wizard.RegistrarEvento(evento);
      const status = String(ret?.status ?? ret?.response?.status ?? ret?.cStat ?? '');
      const message = ret?.response?.xMotivo ?? ret?.message ?? ret?.xMotivo ?? 'Cancelada';

      const ok =
        ret?.success === true ||
        status === '100' ||
        status === 'OK' ||
        status.toLowerCase() === 'sucesso' ||
        /cancel/i.test(message);

      if (!ok) {
        return { success: false, status, message };
      }

      return { success: true, status: status || '100', message };
    } finally {
      removeRedirect();
      cleanupCert(certPath);
    }
  });
}

module.exports = { cancelarNfseSefaz };
