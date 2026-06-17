const fs = require('fs');
const os = require('os');
const path = require('path');
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

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

/** Carrega NFeWizard com certificado; retorna { wizard, certPath } — apague certPath no finally. */
async function createNfeWizard({ admin, cert, senhaEnc, ambiente }) {
  const NFeWizard = await loadNfeWizard();
  if (!NFeWizard) {
    throw new Error('Pacote nfewizard-io não instalado no servidor.');
  }
  const senha = decrypt(senhaEnc);
  const certPath = await downloadCertToTemp(admin, cert.storage_path);
  const wizard = new NFeWizard();
  await wizard.NFE_LoadEnvironment({
    config: {
      dfe: {
        pathCertificado: certPath,
        senhaCertificado: senha,
      },
      nfe: {
        ambiente: Number(ambiente),
      },
    },
  });
  return { wizard, certPath };
}

function cleanupCert(certPath) {
  try {
    if (certPath) fs.unlinkSync(certPath);
  } catch {
    /* ignore */
  }
}

function cStatCancelamentoOk(cStat) {
  const s = String(cStat ?? '');
  return s === '135' || s === '155' || s === '101' || s === '128';
}

async function cancelarNfeSefaz({ admin, nota, perfil, cert, senhaEnc, justificativa }) {
  const xJust = String(justificativa ?? '').trim();
  if (xJust.length < 15) {
    throw new Error('A justificativa de cancelamento deve ter no mínimo 15 caracteres.');
  }
  if (!nota.chave_acesso || !nota.protocolo_autorizacao) {
    throw new Error('Nota sem chave ou protocolo de autorização para cancelar.');
  }

  const chave = onlyDigits(nota.chave_acesso);
  const cOrgao = parseInt(chave.slice(0, 2), 10) || 35;
  const doc = onlyDigits(perfil.documento);
  const isCnpj = doc.length === 14;

  const evento = {
    idLote: Date.now(),
    evento: [
      {
        cOrgao,
        tpAmb: Number(nota.ambiente),
        ...(isCnpj ? { CNPJ: doc } : { CPF: doc }),
        chNFe: chave,
        dhEvento: new Date().toISOString(),
        tpEvento: '110111',
        nSeqEvento: 1,
        verEvento: '1.00',
        detEvento: {
          descEvento: 'Cancelamento',
          nProt: String(nota.protocolo_autorizacao),
          xJust,
        },
      },
    ],
  };

  const { wizard, certPath } = await createNfeWizard({
    admin,
    cert,
    senhaEnc,
    ambiente: nota.ambiente,
  });

  try {
    const ret = await wizard.NFE_Cancelamento(evento);
    const first = Array.isArray(ret) ? ret[0] : ret;
    const cStat = String(
      first?.cStat ?? first?.retEvento?.infEvento?.cStat ?? first?.infEvento?.cStat ?? '',
    );
    const xMotivo =
      first?.xMotivo ?? first?.retEvento?.infEvento?.xMotivo ?? first?.infEvento?.xMotivo ?? 'Sem retorno SEFAZ';

    if (!cStatCancelamentoOk(cStat)) {
      return { success: false, status: cStat, message: xMotivo };
    }

    return { success: true, status: cStat, message: xMotivo };
  } finally {
    cleanupCert(certPath);
  }
}

module.exports = { cancelarNfeSefaz, createNfeWizard, cleanupCert, loadNfeWizard };
