/**
 * POST /api/nfe/artefatos — regenera DANFSe/XML de nota já autorizada (ABRASF).
 */
const { getAdmin, getUserFromBearer } = require('./_lib/supabaseAdmin');
const { salvarArtefatosNfseAbrasf } = require('./_lib/nfseDanfseArtifacts');
const { itemListaServico } = require('./_lib/nfseAbrasfAmericana');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const user = await getUserFromBearer(req);
    const notaFiscalId = req.body?.notaFiscalId;
    if (!notaFiscalId) {
      return res.status(400).json({ success: false, message: 'notaFiscalId é obrigatório.' });
    }

    const admin = getAdmin();
    const { data: nota, error } = await admin
      .from('nota_fiscal')
      .select('*')
      .eq('id', notaFiscalId)
      .eq('user_id', user.id)
      .single();
    if (error || !nota) {
      return res.status(404).json({ success: false, message: 'Nota não encontrada.' });
    }
    if (nota.status !== 'autorizada') {
      return res.status(400).json({ success: false, message: 'Só notas autorizadas geram DANFSe/XML.' });
    }

    const [{ data: perfil }, { data: cliente }, { data: config }, { data: itens }] = await Promise.all([
      admin.from('perfil_cobranca').select('*').eq('user_id', user.id).maybeSingle(),
      admin.from('clientes').select('*').eq('id', nota.cliente_id).maybeSingle(),
      admin.from('nfe_config').select('*').eq('user_id', user.id).maybeSingle(),
      admin.from('nota_fiscal_item').select('*').eq('nota_fiscal_id', notaFiscalId),
    ]);

    const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');
    const artefatos = await salvarArtefatosNfseAbrasf({
      admin,
      userId: nota.user_id,
      chave:
        nota.codigo_verificacao ||
        nota.chave_acesso ||
        nota.protocolo_autorizacao ||
        `${nota.serie}-${nota.numero}`,
      xmlRaw: nota.xml_autorizado,
      meta: {
        prestadorNome: perfil?.razao_social || perfil?.nome_fantasia || 'Prestador',
        prestadorDoc: onlyDigits(perfil?.documento),
        prestadorIm: onlyDigits(config?.inscricao_municipal),
        tomadorNome: cliente?.nome_fantasia || cliente?.nome || 'Tomador',
        tomadorDoc: onlyDigits(cliente?.cnpj) || onlyDigits(cliente?.documento),
        numero: String(nota.numero),
        serie: String(nota.serie || '1'),
        codigoVerificacao: nota.codigo_verificacao,
        chaveAcesso: nota.chave_acesso,
        discriminacao:
          itens?.[0]?.descricao || config?.descricao_servico_padrao || 'Prestação de serviços',
        valor: nota.valor_total,
        itemLista: itemListaServico(config?.codigo_tributacao_nacional || '010701'),
        competencia: nota.competencia || '',
        dataEmissao: String(nota.data_emissao || '').slice(0, 10),
      },
    });

    await admin
      .from('nota_fiscal')
      .update({
        xml_autorizado: artefatos.xml_autorizado || nota.xml_autorizado,
        danfe_url: artefatos.danfe_url,
        danfe_storage_path: artefatos.danfe_storage_path,
      })
      .eq('id', notaFiscalId);

    return res.status(200).json({
      success: true,
      danfe_url: artefatos.danfe_url,
      html: artefatos.html,
      xml_autorizado: Boolean(artefatos.xml_autorizado || nota.xml_autorizado),
      message: 'DANFSe gerada.',
    });
  } catch (e) {
    console.error('nfe/artefatos', e);
    return res.status(500).json({
      success: false,
      message: e?.message ?? 'Falha ao gerar DANFSe/XML.',
    });
  }
};
