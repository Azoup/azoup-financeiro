-- Permite configurar a chave de criptografia do certificado A1 direto pelo app (primeira vez).

create or replace function public.certificado_chave_configurada()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_runtime_config
    where key = 'cert_encryption_key'
      and length(value) >= 16
  );
$$;

revoke all on function public.certificado_chave_configurada() from public;
grant execute on function public.certificado_chave_configurada() to authenticated;

create or replace function public.definir_chave_certificado(p_chave text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autorizado.';
  end if;

  if p_chave is null or length(trim(p_chave)) < 16 then
    raise exception 'Use uma chave com no mínimo 16 caracteres (invente uma senha longa e guarde).';
  end if;

  if exists (
    select 1 from public.app_runtime_config where key = 'cert_encryption_key'
  ) then
    raise exception 'Chave já definida. Para alterar, use o SQL Editor do Supabase.';
  end if;

  insert into public.app_runtime_config (key, value)
  values ('cert_encryption_key', trim(p_chave));
end;
$$;

revoke all on function public.definir_chave_certificado(text) from public;
grant execute on function public.definir_chave_certificado(text) to authenticated;
