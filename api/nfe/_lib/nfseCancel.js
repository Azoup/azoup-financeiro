const { createNfseWizard, cleanupCert, onlyDigits } = require('./nfseWizard');
const { withHomologTlsRelaxed } = require('./tlsHomolog');

async function cancelarNfseSefaz({ admin, nota, perfil, cert, senhaEnc, justificativa, codigoIbgeEmitente }) {
  const xJust = String(justificativa ?? '').trim();
  if (xJust.length < 15) {
    throw new Error('A justificativa de cancelamento deve ter no mínimo 15 caracteres.');
  }
  if (!nota.chave_acesso) {
    throw new Error('Nota sem chave de acesso para cancelar.');
  }

  const chave = onlyDigits(nota.chave_acesso);
  const doc = onlyDigits(perfil.documento);
  const isCnpj = doc.length === 14;
  const ambiente = 2;

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

    try {
      if (typeof wizard.RegistrarEvento !== 'function') {
        throw new Error('Cancelamento NFS-e não disponível nesta versão da biblioteca.');
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
      cleanupCert(certPath);
    }
  });
}

module.exports = { cancelarNfseSefaz };
