import { supabase } from '@/lib/supabase';
import type { FormaPagamento } from '@/types/vendas';

export async function fetchFormasPagamentoAtivas(): Promise<FormaPagamento[]> {
  const { data, error } = await supabase
    .from('formas_pagamento')
    .select('id, nome, ativo, created_at')
    .eq('ativo', true)
    .order('nome', { ascending: true });
  if (error) {
    console.warn('formas_pagamento:', error.message);
    return [];
  }
  return (data as FormaPagamento[] | null) ?? [];
}
