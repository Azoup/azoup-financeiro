function mensagemSegundoBoleto(data) {
  const dia = String(data ?? '').slice(0, 10);
  const [ano, mes, diaNum] = dia.split('-');
  const bonito = ano && mes && diaNum ? `${diaNum}/${mes}/${ano}` : dia;
  return `Este cliente já tem boleto no dia ${bonito}. Não gere nem emita outro.`;
}

/** O carnê mais antigo do cliente naquele vencimento pode ir ao banco. Os demais não. */
async function recusarSegundoBoletoNoDia(admin, userId, boleto, clienteId) {
  const dia = String(boleto.data_vencimento ?? '').slice(0, 10);
  if (!dia || !clienteId) return;

  const candidatos = [];
  const { data: mens, error: eM } = await admin
    .from('mensalidades')
    .select('id')
    .eq('user_id', userId)
    .eq('cliente_id', clienteId)
    .eq('data_vencimento', dia)
    .neq('status', 'cancelado');
  if (eM) throw new Error(eM.message);
  const mensIds = (mens ?? []).map((m) => m.id);
  if (mensIds.length) {
    const { data, error } = await admin
      .from('boletos_parcela_venda')
      .select('id, created_at')
      .eq('user_id', userId)
      .in('mensalidade_id', mensIds)
      .neq('status_registro', 'baixado');
    if (error) throw new Error(error.message);
    candidatos.push(...(data ?? []));
  }

  const { data: vendas, error: eV } = await admin
    .from('vendas')
    .select('id')
    .eq('user_id', userId)
    .eq('cliente_id', clienteId);
  if (eV) throw new Error(eV.message);
  const vendaIds = (vendas ?? []).map((v) => v.id);
  for (let i = 0; i < vendaIds.length; i += 80) {
    const fatia = vendaIds.slice(i, i + 80);
    const { data, error } = await admin
      .from('boletos_parcela_venda')
      .select('id, created_at')
      .eq('user_id', userId)
      .eq('data_vencimento', dia)
      .in('venda_id', fatia)
      .neq('status_registro', 'baixado');
    if (error) throw new Error(error.message);
    candidatos.push(...(data ?? []));
  }

  const unicos = new Map();
  for (const c of candidatos) unicos.set(c.id, c);
  const lista = [...unicos.values()].sort((a, b) => {
    const tempo = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
    if (tempo !== 0) return tempo;
    return String(a.id).localeCompare(String(b.id));
  });
  const primeiro = lista[0];
  if (!primeiro || primeiro.id === boleto.id) return;

  const msg = mensagemSegundoBoleto(dia);
  await admin
    .from('boletos_parcela_venda')
    .update({ status_registro: 'erro', mensagem_erro_registro: msg })
    .eq('id', boleto.id);
  const err = new Error(msg);
  err.boletoRecusado = true;
  throw err;
}

module.exports = { recusarSegundoBoletoNoDia, mensagemSegundoBoleto };
