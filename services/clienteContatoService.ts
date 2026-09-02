import { supabase } from '@/lib/supabase';
import { safeTrim } from '@/utils/safeTrim';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailValido(email: unknown): boolean {
  const s = safeTrim(email);
  return Boolean(s) && EMAIL_RE.test(s);
}

/** Primeiro e-mail cadastrado em contatos_cliente (tipo email). */
export async function fetchEmailCliente(clienteId: unknown): Promise<string | null> {
  const id = safeTrim(clienteId);
  if (!id) return null;
  const { data, error } = await supabase
    .from('contatos_cliente')
    .select('valor_contato')
    .eq('cliente_id', id)
    .eq('tipo_contato', 'email')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const email = safeTrim((data as { valor_contato?: unknown } | null)?.valor_contato);
  return email && isEmailValido(email) ? email : null;
}
