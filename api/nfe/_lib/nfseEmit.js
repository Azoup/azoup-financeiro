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
        console.warn('[nfse] ADN rejeitou', status, message.slice(0, 300));
        return {
          success: false,
          status,
          message: humanizeNfseRejection(message, config.codigo_ibge_emitente),
        };
      }

      const xmlProc = extrairXml(ret);

      // DANFSe é opcional e não pode segurar a autorização até estourar o timeout
      // da Vercel (nota ficava presa em "processando").
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
            const gerarComTimeout = Promise.race([
              gerar({
                data: ret?.response ?? ret,
                chave,
                outputPath: tmpPdf,
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('DANFSe demorou demais; autorização já ok.')), 12000),
              ),
            ]);
            await gerarComTimeout;
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
          console.warn('DANFSe PDF:', danfeErr?.message ?? danfeErr);
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
        message: typeof message === 'string' && message && message !== 'Autorizada' ? message : 'Autorizada',
      };
    } finally {
      cleanupCert(certPath);
    }
  });
}

module.exports = { emitirNfseSefaz };
