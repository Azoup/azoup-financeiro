import { supabase } from '@/lib/supabase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailValido(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Primeiro e-mail cadastrado em contatos_cliente (tipo email). */
export async function fetchEmailCliente(clienteId: string): Promise<string | null> {
  if (!clienteId?.trim()) return null;
  const { data, error } = await supabase
    .from('contatos_cliente')
    .select('valor_contato')
    .eq('cliente_id', clienteId)
    .eq('tipo_contato', 'email')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const email = (data as { valor_contato?: string } | null)?.valor_contato?.trim();
  return email && isEmailValido(email) ? email : null;
}
