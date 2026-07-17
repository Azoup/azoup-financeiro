const { getAdmin, getUserFromBearer } = require('./_lib/supabaseAdmin');
const { salvarArtefatosNfseAbrasf, formatEndereco } = require('./_lib/nfseDanfseArtifacts');
const { itemListaServico } = require('./_lib/nfseAbrasfAmericana');
const { resolveEmitenteContexto, onlyDigits } = require('./_lib/nfseEmitenteResolve');

function joinEndereco(row) {
  if (!row) return '—';
  return formatEndereco({
    logradouro: row.logradouro,
    numero: row.numero,
    bairro: row.bairro,
    cep: row.cep,
  });
}

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

    const [{ data: cliente }, { data: itens }, emitCtx] = await Promise.all([
      admin.from('clientes').select('*').eq('id', nota.cliente_id).maybeSingle(),
      admin.from('nota_fiscal_item').select('*').eq('nota_fiscal_id', notaFiscalId),
      resolveEmitenteContexto(admin, user.id, nota),
    ]);

    const { perfil, config, emitente } = emitCtx;
    const prest = emitente || perfil || {};
    const itemLista = itemListaServico(config?.codigo_tributacao_nacional || '010701');

    // Número da NFS-e TipLan (protocolo) tem prioridade sobre o RPS (nota.numero)
    const numeroNfse =
      onlyDigits(nota.protocolo_autorizacao) ||
      String(nota.numero ?? '');

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
        prestadorNome: prest.razao_social || 'Prestador',
        prestadorFantasia: prest.nome || prest.razao_social || '',
        prestadorDoc: onlyDigits(prest.documento),
        prestadorIm: onlyDigits(config?.inscricao_municipal || prest.inscricao_municipal),
        prestadorIe: prest.inscricao_estadual || config?.inscricao_estadual || '',
        prestadorTel: prest.telefone_suporte || '',
        prestadorEmail: '',
        prestadorEndereco: joinEndereco(prest),
        prestadorMunicipio: (prest.cidade || 'AMERICANA').toUpperCase(),
        prestadorUf: (prest.uf || 'SP').toUpperCase(),
        tomadorNome: cliente?.nome || cliente?.nome_fantasia || 'Tomador',
        tomadorDoc: onlyDigits(cliente?.cnpj) || onlyDigits(cliente?.documento),
        tomadorIm: '',
        tomadorIe: cliente?.inscricao_estadual || '',
        tomadorTel: cliente?.celular || '',
        tomadorEmail: cliente?.email || '',
        tomadorEndereco: joinEndereco(cliente),
        tomadorMunicipio: (cliente?.cidade || '').toUpperCase(),
        tomadorUf: (cliente?.estado || cliente?.uf || '').toUpperCase(),
        numero: numeroNfse,
        serie: String(nota.serie || '1'),
        rpsNumero: String(nota.numero ?? ''),
        rpsSerie: String(nota.serie || '1'),
        rpsDataEmissao: nota.data_emissao,
        codigoVerificacao: nota.codigo_verificacao,
        chaveAcesso: nota.chave_acesso,
        discriminacao:
          itens?.[0]?.descricao || config?.descricao_servico_padrao || 'Prestação de serviços',
        valor: nota.valor_total,
        itemLista,
        competencia: nota.competencia || '',
        dataEmissao: nota.data_emissao || String(nota.data_emissao || '').slice(0, 10),
        documentoCobranca: String(nota.numero ?? numeroNfse),
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
