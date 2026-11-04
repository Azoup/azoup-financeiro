const { buildNFSeLayout } = require('./buildNFSeFromDb');
const { createNfseWizard, cleanupCert, downloadCertToTemp } = require('./nfseWizard');
const { decryptCertPassword } = require('./crypto');
const { withHomologTlsRelaxed } = require('./tlsHomolog');
const { humanizeNfseRejection, validarConvenioMunicipio } = require('./nfseErrors');
const { installMunicipalAxiosRedirect } = require('./municipalAxiosRedirect');
const { resolveNfseGateway, isOptanteSimplesNacional } = require('./nfseGateways');
const { emitirNfsePaulistana } = require('./nfsePaulistana');
const { emitirNfseAbrasfAmericana, itemListaServico } = require('./nfseAbrasfAmericana');
const { salvarArtefatosNfseAbrasf } = require('./nfseDanfseArtifacts');
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

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** L985/AL986: ADN aceitou o lote mas processa em fila (não é rejeição fiscal). */
function isFilaProcessamentoAdn(message) {
  return /L985|AL986|fila de processamento no ADN|aguardando processamento no ADN/i.test(
    String(message ?? ''),
  );
}

function extrairProtocoloFila(message) {
  const m = String(message ?? '').match(/protocolo[:\s]+(\d{6,})/i);
  return m?.[1] ?? null;
}

/**
 * Id da DPS (45 chars): DPS + IBGE(7) + tpInsc(1) + insc(14) + série(5) + nDPS(15).
 * Mesma regra do @nfewizard/nfse (CNPJ=2, CPF=1).
 */
function buildIdDps(layout, perfil) {
  const inf = layout?.DPS?.infDps ?? {};
  if (inf.Id && String(inf.Id).length >= 45) return String(inf.Id);
  const cLocEmi = String(inf.cLocEmi ?? '')
    .replace(/\D/g, '')
    .padStart(7, '0')
    .slice(0, 7);
  const prest = inf.prest ?? {};
  let tipoInscricao;
  let inscricaoFederal;
  if (prest.CNPJ) {
    tipoInscricao = '2';
    inscricaoFederal = String(prest.CNPJ).replace(/\D/g, '').padStart(14, '0').slice(0, 14);
  } else if (prest.CPF) {
    tipoInscricao = '1';
    inscricaoFederal = String(prest.CPF).replace(/\D/g, '').padStart(14, '0').slice(0, 14);
  } else {
    const doc = String(perfil?.documento ?? '').replace(/\D/g, '');
    tipoInscricao = doc.length <= 11 ? '1' : '2';
    inscricaoFederal = doc.padStart(14, '0').slice(0, 14);
  }
  const serie = String(inf.serie ?? '1')
    .replace(/\D/g, '')
    .padStart(5, '0')
    .slice(0, 5);
  const nDPS = String(inf.nDPS ?? '')
    .replace(/\D/g, '')
    .padStart(15, '0')
    .slice(0, 15);
  return `DPS${cLocEmi}${tipoInscricao}${inscricaoFederal}${serie}${nDPS}`;
}

/**
 * Após L985: consulta a DPS até o ADN devolver a chave (ou esgota o tempo).
 */
async function aguardarAutorizacaoFilaAdn(wizard, layout, perfil, protocoloHint) {
  const idDps = buildIdDps(layout, perfil);
  console.info('[nfse] L985 fila ADN — consultando DPS', idDps, protocoloHint || '');

  let ultimaMsg = 'NFS-e ainda na fila do ADN.';
  for (let i = 0; i < 10; i += 1) {
    if (i > 0) await esperar(2500);
    try {
      const cons = await wizard.ConsultaDPS({ id: idDps });
      const chave =
        cons?.chaveAcesso ??
        cons?.response?.chaveAcesso ??
        cons?.chNFSe ??
        cons?.response?.chNFSe ??
        null;
      if (!chave) {
        ultimaMsg = extrairMensagemAdn(cons, ultimaMsg);
        continue;
      }

      let xmlProc = extrairXml(cons);
      let codigoVerificacao =
        cons?.codigoVerificacao ?? cons?.response?.codigoVerificacao ?? null;
      try {
        const nfse = await wizard.Consulta({ chaveAcesso: chave });
        xmlProc = extrairXml(nfse) || xmlProc;
        codigoVerificacao =
          nfse?.codigoVerificacao ?? nfse?.response?.codigoVerificacao ?? codigoVerificacao;
      } catch (e) {
        console.warn('[nfse] Consulta NFSe após DPS:', e?.message || e);
      }

      return {
        success: true,
        status: '100',
        chave_acesso: chave,
        protocolo_autorizacao: protocoloHint || null,
        codigo_verificacao: codigoVerificacao,
        xml_autorizado: xmlProc,
        message: 'Autorizada (fila ADN)',
      };
    } catch (e) {
      ultimaMsg = e?.message || String(e);
      console.warn('[nfse] ConsultaDPS tentativa', i + 1, ultimaMsg.slice(0, 200));
    }
  }

  return {
    success: false,
    pending: true,
    status: 'L985',
    protocolo_autorizacao: protocoloHint || null,
    message:
      `L985/AL986 — DPS enviada à fila do ADN (protocolo ${protocoloHint || '—'}). ` +
      'Ainda não autorizou neste ciclo; a nota ficou em processamento. Abra Notas fiscais e use Reemitir/consultar em alguns minutos. ' +
      `(DPS ${idDps})`,
  };
}

/** Junta código + complemento do ADN (quando a lib só devolve "E1235"). */
function extrairMensagemAdn(ret, fallback) {
  const r = ret?.response ?? ret ?? {};
  const parts = [
    r.erros,
    r.mensagens,
    r.alerts,
    r.message,
    r.xMotivo,
    r.descricao,
    r.Complemento,
    r.complemento,
    r.detail,
    r.erro,
  ]
    .flatMap((x) => (Array.isArray(x) ? x : x != null ? [x] : []))
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return [item.Codigo, item.codigo, item.Descricao, item.descricao, item.Complemento, item.complemento, item.mensagem, item.message]
        .filter(Boolean)
        .join(' — ');
    })
    .filter(Boolean);
  const joined = parts.join(' | ');
  if (joined) return joined.slice(0, 800);
  try {
    const dump = JSON.stringify(r);
    if (dump && dump !== '{}' && dump !== 'null') return dump.slice(0, 800);
  } catch {
    /* ignore */
  }
  return String(fallback ?? 'Autorizacao rejeitada');
}

async function emitirNfseSefaz({ admin, nota, itens, perfil, cliente, config, cert, senhaEnc }) {
  const ambiente = 1; // produção
  const optanteSimples = isOptanteSimplesNacional(config);
  const gateway = resolveNfseGateway(config.codigo_ibge_emitente, ambiente, {
    config,
    optanteSimples,
  });

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

  // Americana Regime Normal → ABRASF TipLan.
  // Simples Nacional → SEFIN Emissor Nacional via resolveNfseGateway (mode nacional).
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
      if (result.success) {
        const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');
        const { formatEndereco } = require('./nfseDanfseArtifacts');
        const joinEnd = (row) =>
          formatEndereco({
            logradouro: row?.logradouro,
            numero: row?.numero,
            bairro: row?.bairro,
            cep: row?.cep,
          });
        const artefatos = await salvarArtefatosNfseAbrasf({
          admin,
          userId: nota.user_id,
          chave:
            result.codigo_verificacao ||
            result.chave_acesso ||
            result.protocolo_autorizacao ||
            `${nota.serie}-${nota.numero}`,
          xmlRaw: result.xml_autorizado,
          meta: {
            prestadorNome: perfil.razao_social || perfil.nome_fantasia || 'Prestador',
            prestadorFantasia: perfil.nome_fantasia || perfil.razao_social || '',
            prestadorDoc: onlyDigits(perfil.documento),
            prestadorIm: onlyDigits(config.inscricao_municipal),
            prestadorIe: config.inscricao_estadual || '',
            prestadorTel: perfil.telefone_suporte || '',
            prestadorEndereco: joinEnd(perfil),
            prestadorMunicipio: (perfil.cidade || 'AMERICANA').toUpperCase(),
            prestadorUf: (perfil.uf || 'SP').toUpperCase(),
            tomadorNome:
              cliente.nome || cliente.razao_social || cliente.nome_empresa || cliente.nome_fantasia || cliente.nome_cliente || 'Tomador',
            tomadorDoc: onlyDigits(cliente.cnpj) || onlyDigits(cliente.documento),
            tomadorIe: cliente.inscricao_estadual || '',
            tomadorTel: cliente.celular || '',
            tomadorEmail: cliente.email || '',
            tomadorEndereco: joinEnd(cliente),
            tomadorMunicipio: (cliente.cidade || '').toUpperCase(),
            tomadorUf: (cliente.estado || cliente.uf || '').toUpperCase(),
            numero: String(result.protocolo_autorizacao || result.numero || nota.numero),
            serie: String(nota.serie || config.serie || '1'),
            rpsNumero: String(nota.numero),
            rpsSerie: String(nota.serie || config.serie || '1'),
            rpsDataEmissao: nota.data_emissao,
            codigoVerificacao: result.codigo_verificacao,
            chaveAcesso: result.chave_acesso,
            discriminacao:
              itens[0]?.descricao || config.descricao_servico_padrao || 'Prestação de serviços',
            valor: nota.valor_total,
            itemLista: itemListaServico(config.codigo_tributacao_nacional),
            competencia: nota.competencia || '',
            dataEmissao: nota.data_emissao || String(nota.data_emissao || '').slice(0, 10),
            documentoCobranca: String(nota.numero),
            regimeTributario: Number(config.regime_tributario ?? 0) || null,
            opSimpNac: Number(config.op_simp_nac ?? 0) || null,
          },
        });
        result.xml_autorizado = artefatos.xml_autorizado || result.xml_autorizado;
        result.danfe_url = artefatos.danfe_url;
        result.danfe_storage_path = artefatos.danfe_storage_path;
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

  const layout = await buildNFSeLayout({ nota, itens, perfil, cliente, config });

  return withHomologTlsRelaxed(async () => {
    const { wizard, certPath, gateway: gw } = await createNfseWizard({
      admin,
      cert,
      senhaEnc,
      perfil,
      ambiente,
      ibge: config.codigo_ibge_emitente,
      gatewayOpts: { config, optanteSimples },
    });

    try {
      const inf = layout?.DPS?.infDps ?? {};
      console.info('[nfse] gateway ADN', {
        nome: gw.nome,
        mode: gw.mode,
        url: gw.urlOverrides?.NFSe_Autorizacao ?? 'SEFIN',
        opSimpNac: inf?.prest?.regTrib?.opSimpNac,
        regApTribSN: inf?.prest?.regTrib?.regApTribSN ?? null,
        dCompet: inf?.dCompet,
        hasIBSCBS: Boolean(inf?.IBSCBS),
        regTrib: inf?.prest?.regTrib,
      });
      // Simples a partir de 11/2026: habilitado no ADN por regra federal (CGSN),
      // mesmo se ConsultarConvenio do município ainda não marca "emissor público".
      const pularConvenio =
        gw.skipConvenioNacional ||
        (optanteSimples &&
          String(inf?.dCompet ?? '').slice(0, 7) >= '2026-11');
      if (!pularConvenio) {
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
        // Redirect municipal só com urlOverrides; mode nacional SEFIN não redireciona.
        if (gw.urlOverrides && gw.mode === 'municipal') {
          removeRedirect = await installMunicipalAxiosRedirect(wizard, gw.urlOverrides);
          console.info('[nfse] redirect municipal', gw.nome, gw.urlOverrides.NFSe_Autorizacao);
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
      const message = extrairMensagemAdn(ret, 'Autorizada');

      const ok =
        ret?.success === true ||
        status === '100' ||
        status === 'OK' ||
        status.toLowerCase() === 'sucesso' ||
        Boolean(chave);

      if (!ok) {
        // L985/AL986 = fila assíncrona do ADN (comum sob carga / CNPJ novo), não rejeição.
        if (isFilaProcessamentoAdn(message) || isFilaProcessamentoAdn(status)) {
          const protocoloFila = protocolo || extrairProtocoloFila(message);
          const fila = await aguardarAutorizacaoFilaAdn(wizard, layout, perfil, protocoloFila);
          if (fila.success) {
            // Segue o fluxo normal de DANFSe abaixo com estes dados.
            ret = {
              success: true,
              status: '100',
              response: {
                chaveAcesso: fila.chave_acesso,
                nProt: fila.protocolo_autorizacao,
                codigoVerificacao: fila.codigo_verificacao,
                xml: fila.xml_autorizado,
              },
            };
          } else {
            return {
              success: false,
              pending: true,
              status: fila.status || 'L985',
              protocolo_autorizacao: fila.protocolo_autorizacao,
              message: humanizeNfseRejection(fila.message, config.codigo_ibge_emitente),
            };
          }
        } else {
          console.warn('[nfse] ADN rejeitou', status, message.slice(0, 300));
          return {
            success: false,
            status,
            message: humanizeNfseRejection(message, config.codigo_ibge_emitente),
          };
        }
      }

      const chaveFinal =
        ret?.response?.chaveAcesso ??
        ret?.response?.chNFSe ??
        ret?.chaveAcesso ??
        ret?.chNFSe ??
        chave;
      const protocoloFinal =
        ret?.response?.nProt ??
        ret?.response?.protocolo ??
        ret?.nProt ??
        ret?.protocolo ??
        protocolo;
      const codigoVerificacaoFinal =
        ret?.response?.codigoVerificacao ?? ret?.codigoVerificacao ?? codigoVerificacao;
      const statusFinal = String(ret?.status ?? ret?.response?.status ?? ret?.cStat ?? (status || '100'));
      const messageFinal = extrairMensagemAdn(ret, message || 'Autorizada');

      const xmlProc = extrairXml(ret);

      // DANFSe é opcional e não pode segurar a autorização até estourar o timeout
      // da Vercel (nota ficava presa em "processando").
      let danfeUrl = null;
      let danfePath = null;
      if (xmlProc && chaveFinal) {
        try {
          const danfeMod = await import('@nfewizard/danfe');
          const gerar = danfeMod.NFSE_GerarDanfe ?? danfeMod.default?.NFSE_GerarDanfe;
          if (typeof gerar === 'function') {
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            const tmpPdf = path.join(os.tmpdir(), `danfse-${Date.now()}.pdf`);
            const gerarComTimeout = Promise.race([
              gerar({
                data: ret?.response ?? ret,
                chave: chaveFinal,
                outputPath: tmpPdf,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('DANFSe demorou demais; autorização já ok.')), 12000),
              ),
            ]);
            await gerarComTimeout;
            const pdfBuffer = fs.readFileSync(tmpPdf);
            danfePath = `${nota.user_id}/${chaveFinal}.pdf`;
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
          console.warn('DANFSe PDF:', danfeErr?.message ?? danfeErr);
        }
      }

      return {
        success: true,
        status: statusFinal,
        chave_acesso: chaveFinal,
        protocolo_autorizacao: protocoloFinal,
        codigo_verificacao: codigoVerificacaoFinal,
        xml_autorizado: xmlProc,
        danfe_url: danfeUrl,
        danfe_storage_path: danfePath,
        message:
          typeof messageFinal === 'string' && messageFinal && messageFinal !== 'Autorizada'
            ? messageFinal
            : 'Autorizada',
      };
    } finally {
      cleanupCert(certPath);
    }
  });
}

/**
 * Recupera NFS-e já autorizada no ADN sem reenviar DPS (evita duplicar após L985).
 * Usado em Reemitir / L1260 quando a nota local ainda está rejeitada/processando.
 */
async function tentarRecuperarNfseDoAdn({ admin, nota, itens, perfil, cliente, config, cert, senhaEnc }) {
  try {
    const ambiente = 1;
    const optanteSimples = isOptanteSimplesNacional(config);
    const gateway = resolveNfseGateway(config.codigo_ibge_emitente, ambiente, {
      config,
      optanteSimples,
    });
    if (gateway.mode !== 'nacional' && gateway.mode !== 'municipal') {
      return { success: false, message: 'Recuperação ADN só no SEFIN/ADN.' };
    }

    const layout = await buildNFSeLayout({ nota, itens, perfil, cliente, config });
    return withHomologTlsRelaxed(async () => {
      const { wizard, certPath } = await createNfseWizard({
        admin,
        cert,
        senhaEnc,
        perfil,
        ambiente,
        ibge: config.codigo_ibge_emitente,
        gatewayOpts: { config, optanteSimples },
      });
      try {
        const protocoloHint =
          String(nota.protocolo_autorizacao || '').replace(/\D/g, '') ||
          extrairProtocoloFila(nota.motivo_rejeicao) ||
          null;
        // Uma tentativa rápida + algumas esperas curtas (nota pode ter acabado de autorizar).
        const idDps = buildIdDps(layout, perfil);
        for (let i = 0; i < 4; i += 1) {
          if (i > 0) await esperar(2000);
          try {
            const cons = await wizard.ConsultaDPS({ id: idDps });
            const chave =
              cons?.chaveAcesso ??
              cons?.response?.chaveAcesso ??
              cons?.chNFSe ??
              cons?.response?.chNFSe ??
              null;
            if (!chave) continue;

            let xmlProc = extrairXml(cons);
            let codigoVerificacao =
              cons?.codigoVerificacao ?? cons?.response?.codigoVerificacao ?? null;
            try {
              const nfse = await wizard.Consulta({ chaveAcesso: chave });
              xmlProc = extrairXml(nfse) || xmlProc;
              codigoVerificacao =
                nfse?.codigoVerificacao ?? nfse?.response?.codigoVerificacao ?? codigoVerificacao;
            } catch {
              /* xml opcional */
            }

            return {
              success: true,
              status: '100',
              chave_acesso: chave,
              protocolo_autorizacao: protocoloHint,
              codigo_verificacao: codigoVerificacao,
              xml_autorizado: xmlProc,
              message: 'NFS-e recuperada do ADN (já estava autorizada; não reemitimos).',
            };
          } catch (e) {
            console.warn('[nfse] recuperar ADN', i + 1, e?.message || e);
          }
        }
        return {
          success: false,
          message: `DPS ${idDps} ainda não autorizada no ADN.`,
        };
      } finally {
        cleanupCert(certPath);
      }
    });
  } catch (e) {
    return {
      success: false,
      message: e?.message || String(e),
    };
  }
}

module.exports = {
  emitirNfseSefaz,
  tentarRecuperarNfseDoAdn,
  isFilaProcessamentoAdn,
};
