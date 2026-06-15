import { supabase } from '@/lib/supabase';
import type { PerfilCobranca, PerfilCobrancaInput } from '@/types/contasReceber';

export async function fetchPerfilCobranca(userId: string): Promise<PerfilCobranca | null> {
  const { data, error } = await supabase
    .from('perfil_cobranca')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PerfilCobranca | null) ?? null;
}

export async function upsertPerfilCobranca(userId: string, input: PerfilCobrancaInput): Promise<void> {
  const row = {
    user_id: userId,
    razao_social: input.razao_social.trim(),
    documento: input.documento.trim(),
    logradouro: input.logradouro.trim(),
    numero: input.numero.trim(),
    complemento: input.complemento.trim(),
    bairro: input.bairro.trim(),
    cidade: input.cidade.trim(),
    uf: input.uf.trim().toUpperCase().slice(0, 2),
    cep: input.cep.trim(),
    cooperativa_nome: input.cooperativa_nome?.trim() || null,
    codigo_beneficiario_agencia: input.codigo_beneficiario_agencia?.trim() || null,
    telefone_suporte: input.telefone_suporte?.trim() || null,
    instrucoes_cobranca: input.instrucoes_cobranca.trim(),
    local_pagamento: input.local_pagamento.trim() || 'PAGÁVEL PREFERENCIALMENTE NOS CANAIS DO SEU BANCO',
    mensagem_padrao_pagador: input.mensagem_padrao_pagador?.trim() || null,
  };
  const { error } = await supabase.from('perfil_cobranca').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}
