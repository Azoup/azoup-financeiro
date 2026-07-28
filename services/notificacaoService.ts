import { supabase } from '@/lib/supabase';
import { formatBRDate, parseISODate, toISODate } from '@/utils/date';

export type NotificacaoTipo = 'paralisado_retorno';

export type Notificacao = {
  id: string;
  user_id: string;
  tipo: string;
  titulo: string;
  corpo: string;
  chave: string;
  lida: boolean;
  alerta_exibido: boolean;
  created_at: string;
};

export type ClienteRetornoParalisado = {
  id: string;
  nome: string;
  congelado_ate: string;
};

/** Clientes cuja data de retorno (paralisado até) já chegou. */
export async function fetchClientesRetornoParalisado(
  userId: string,
): Promise<ClienteRetornoParalisado[]> {
  const hoje = toISODate(new Date());
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nome_fantasia, nome, congelado_ate')
    .eq('user_id', userId)
    .eq('cancelado', false)
    .not('congelado_ate', 'is', null)
    .lte('congelado_ate', hoje)
    .order('congelado_ate', { ascending: true });

  if (error) {
    if (/congelado_ate|column|schema cache/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message);
  }

  return (data ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    nome: String(
      (r as { nome_fantasia?: string | null; nome?: string | null }).nome_fantasia?.trim() ||
        (r as { nome?: string | null }).nome?.trim() ||
        'Cliente',
    ),
    congelado_ate: String((r as { congelado_ate: string }).congelado_ate).slice(0, 10),
  }));
}

/**
 * Cria notificações de retorno (idempotente por cliente+data).
 * Retorna as que ainda não tiveram o alerta modal exibido.
 */
export async function sincronizarNotificacoesParalisados(userId: string): Promise<{
  novasParaAlerta: Notificacao[];
  clientes: ClienteRetornoParalisado[];
}> {
  const clientes = await fetchClientesRetornoParalisado(userId);
  const novasParaAlerta: Notificacao[] = [];

  for (const c of clientes) {
    const chave = `paralisado_retorno:${c.id}:${c.congelado_ate}`;
    const dataFmt = formatBRDate(parseISODate(c.congelado_ate)) || c.congelado_ate;
    const titulo = 'Cliente paralisado — retorno';
    const corpo = `${c.nome} — retorno em ${dataFmt}. Já pode gerar mensalidade novamente.`;

    const { data: existing, error: e0 } = await supabase
      .from('notificacoes')
      .select('*')
      .eq('user_id', userId)
      .eq('chave', chave)
      .maybeSingle();

    if (e0) {
      if (/notificacoes|relation|schema cache|does not exist/i.test(e0.message)) {
        throw new Error(
          'Falta a migration de notificações. Rode supabase/migrations/044_notificacoes.sql no SQL Editor.',
        );
      }
      throw new Error(e0.message);
    }

    if (existing) {
      const row = existing as Notificacao;
      if (!row.alerta_exibido) novasParaAlerta.push(row);
      continue;
    }

    const { data: inserted, error: e1 } = await supabase
      .from('notificacoes')
      .insert({
        user_id: userId,
        tipo: 'paralisado_retorno' satisfies NotificacaoTipo,
        titulo,
        corpo,
        chave,
        lida: false,
        alerta_exibido: false,
      })
      .select('*')
      .single();

    if (e1) {
      if (/duplicate|unique|23505/i.test(e1.message)) continue;
      throw new Error(e1.message);
    }
    if (inserted) novasParaAlerta.push(inserted as Notificacao);
  }

  return { novasParaAlerta, clientes };
}

export async function fetchNotificacoes(
  userId: string,
  opts?: { limit?: number },
): Promise<Notificacao[]> {
  const { data, error } = await supabase
    .from('notificacoes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 50);

  if (error) {
    if (/notificacoes|relation|schema cache|does not exist/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []) as Notificacao[];
}

export async function countNotificacoesNaoLidas(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notificacoes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('lida', false);

  if (error) {
    if (/notificacoes|relation|schema cache|does not exist/i.test(error.message)) {
      return 0;
    }
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function marcarNotificacaoLida(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('notificacoes')
    .update({ lida: true })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function marcarTodasNotificacoesLidas(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notificacoes')
    .update({ lida: true })
    .eq('user_id', userId)
    .eq('lida', false);
  if (error) throw new Error(error.message);
}

export async function marcarAlertasExibidos(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from('notificacoes')
    .update({ alerta_exibido: true })
    .eq('user_id', userId)
    .in('id', ids);
  if (error) throw new Error(error.message);
}
