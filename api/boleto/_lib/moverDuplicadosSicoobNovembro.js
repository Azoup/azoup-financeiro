const { alterarBoletoSicoobApi, cleanupCert } = require('./sicoobClient');
const { loadSicoobCredentials } = require('./sicoobCredentials');

function diaIso(valor) {
  return String(valor ?? '').slice(0, 10);
}

function novembroMesmoDia(iso) {
  const [ano, mes, dia] = diaIso(iso).split('-').map(Number);
  if (!ano || mes !== 10 || !dia) return null;
  const ultimo = new Date(ano, 11, 0).getDate();
  const diaNovo = Math.min(dia, ultimo);
  return `${ano}-11-${String(diaNovo).padStart(2, '0')}`;
}

function trocarMes(texto, deIso, paraIso) {
  if (!texto) return texto;
  const [anoDe, mesDe] = diaIso(deIso).split('-');
  const [anoPara, mesPara] = diaIso(paraIso).split('-');
  return String(texto)
    .split(`${mesDe}/${anoDe}`)
    .join(`${mesPara}/${anoPara}`)
    .split(`${anoDe}-${mesDe}`)
    .join(`${anoPara}-${mesPara}`);
}

async function listarBoletosSicoob(admin, userId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('boletos_parcela_venda')
      .select(
        'id, created_at, data_vencimento, valor_documento, status_registro, nosso_numero_banco, mensalidade_id, venda_id, parcela_id, pagador_nome, emitente_id, venda_descricao_resumo',
      )
      .eq('user_id', userId)
      .eq('tipo_emissao', 'sicoob')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return rows.filter((b) => b.status_registro !== 'baixado' && b.status_registro !== 'pago');
}

async function vinculos(admin, boletos) {
  const mensIds = [...new Set(boletos.map((b) => b.mensalidade_id).filter(Boolean))];
  const vendaIds = [...new Set(boletos.map((b) => b.venda_id).filter(Boolean))];
  const mensalidades = new Map();
  const vendas = new Map();

  for (let i = 0; i < mensIds.length; i += 80) {
    const fatia = mensIds.slice(i, i + 80);
    const { data, error } = await admin
      .from('mensalidades')
      .select('id, cliente_id, status, competencia')
      .in('id', fatia);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) mensalidades.set(row.id, row);
  }
  for (let i = 0; i < vendaIds.length; i += 80) {
    const fatia = vendaIds.slice(i, i + 80);
    const { data, error } = await admin.from('vendas').select('id, cliente_id').in('id', fatia);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) vendas.set(row.id, row);
  }
  return { mensalidades, vendas };
}

function candidatosNovembro(boletos, mensalidades, vendas) {
  const grupos = new Map();
  for (const boleto of boletos) {
    const men = boleto.mensalidade_id ? mensalidades.get(boleto.mensalidade_id) : null;
    if (men?.status === 'cancelado') continue;
    const clienteId = men?.cliente_id ?? (boleto.venda_id ? vendas.get(boleto.venda_id)?.cliente_id : null);
    if (!clienteId) continue;
    const dia = diaIso(boleto.data_vencimento);
    if (!novembroMesmoDia(dia)) continue;
    const chave = `${clienteId}|${dia}|${Number(boleto.valor_documento).toFixed(2)}`;
    const lista = grupos.get(chave) ?? [];
    lista.push({ boleto, clienteId, competencia: men?.competencia ?? null });
    grupos.set(chave, lista);
  }

  const ocupados = new Set(
    boletos.map((b) => {
      const men = b.mensalidade_id ? mensalidades.get(b.mensalidade_id) : null;
      const clienteId = men?.cliente_id ?? (b.venda_id ? vendas.get(b.venda_id)?.cliente_id : null);
      return clienteId ? `${clienteId}|${diaIso(b.data_vencimento)}` : '';
    }),
  );

  const alvos = [];
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => {
      const tempo = String(a.boleto.created_at ?? '').localeCompare(String(b.boleto.created_at ?? ''));
      if (tempo !== 0) return tempo;
      return String(a.boleto.id).localeCompare(String(b.boleto.id));
    });
    const ultimo = lista[lista.length - 1];
    const nova = novembroMesmoDia(ultimo.boleto.data_vencimento);
    if (!nova) continue;
    if (ocupados.has(`${ultimo.clienteId}|${nova}`)) continue;
    ocupados.add(`${ultimo.clienteId}|${nova}`);
    alvos.push({ ...ultimo, nova });
  }
  return alvos;
}

/**
 * Tira a data limite antes de mudar o vencimento.
 * Não envia "", null nem outra data: o Sicoob rejeita string vazia
 * ("formato da data é inválido") e, se o campo já está preenchido, só
 * mandar o vencimento não apaga o limite antigo.
 */
async function limparDataLimitePagamento(credenciais, nossoNumero) {
  await alterarBoletoSicoobApi({
    ...credenciais,
    nossoNumero,
    objeto: { prorrogacaoLimitePagamento: {} },
  });
}

async function atualizarLocal(admin, alvo) {
  const { boleto, nova, competencia } = alvo;
  const resumo = trocarMes(boleto.venda_descricao_resumo, boleto.data_vencimento, nova);
  const { error } = await admin
    .from('boletos_parcela_venda')
    .update({
      data_vencimento: nova,
      venda_descricao_resumo: resumo,
    })
    .eq('id', boleto.id);
  if (error) throw new Error(error.message);

  if (boleto.mensalidade_id) {
    const { error: eM } = await admin
      .from('mensalidades')
      .update({
        data_vencimento: nova,
        competencia: trocarMes(competencia, boleto.data_vencimento, nova),
      })
      .eq('id', boleto.mensalidade_id);
    if (eM) throw new Error(eM.message);
  }
  if (boleto.parcela_id) {
    const { error: eP } = await admin
      .from('parcelas_venda')
      .update({ data_vencimento: nova })
      .eq('id', boleto.parcela_id);
    if (eP) throw new Error(eP.message);
  }
}

async function moverDuplicadosSicoobParaNovembro(admin, userId, limite = 6) {
  const boletos = await listarBoletosSicoob(admin, userId);
  const { mensalidades, vendas } = await vinculos(admin, boletos);
  const alvos = candidatosNovembro(boletos, mensalidades, vendas);
  const lote = alvos.slice(0, limite);
  const alterados = [];
  const erros = [];

  let credenciais = null;
  try {
    credenciais = await loadSicoobCredentials(admin, userId, null);
  } catch (e) {
    credenciais = null;
    if (lote.some((a) => a.boleto.nosso_numero_banco)) {
      throw e;
    }
  }

  for (const alvo of lote) {
    const nome = alvo.boleto.pagador_nome || 'Cliente';
    const de = diaIso(alvo.boleto.data_vencimento);
    try {
      let noBanco = false;
      if (alvo.boleto.nosso_numero_banco) {
        if (!credenciais) throw new Error('Sicoob não configurado para alterar o vencimento.');
        await limparDataLimitePagamento(credenciais, alvo.boleto.nosso_numero_banco);
        await alterarBoletoSicoobApi({
          ...credenciais,
          nossoNumero: alvo.boleto.nosso_numero_banco,
          objeto: { prorrogacaoVencimento: { dataVencimento: alvo.nova } },
        });
        noBanco = true;
      }
      await atualizarLocal(admin, alvo);
      alterados.push({
        boletoId: alvo.boleto.id,
        cliente: nome,
        de,
        para: alvo.nova,
        sicoob: noBanco,
      });
    } catch (e) {
      erros.push({ boletoId: alvo.boleto.id, cliente: nome, erro: e.message ?? 'Falha ao alterar.' });
    }
  }

  if (credenciais?.certPath) cleanupCert(credenciais.certPath);

  return {
    alterados: alterados.length,
    restantes: Math.max(0, alvos.length - alterados.length),
    itens: alterados,
    erros,
  };
}

module.exports = { moverDuplicadosSicoobParaNovembro };
