-- Senha do certificado A1 via RPC (funciona direto pelo app, sem depender só da API Vercel).

create extension if not exists pgcrypto;

create table if not exists public.app_runtime_config (
  key text primary key,
  value text not null
);

alter table public.app_runtime_config enable row level security;

comment on table public.app_runtime_config is
  'Configuração interna (sem policy para authenticated). Chave cert_encryption_key = mesma CERT_ENCRYPTION_KEY da Vercel.';

create or replace function public.get_app_runtime_config(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select value from public.app_runtime_config where key = p_key limit 1;
$$;

revoke all on function public.get_app_runtime_config(text) from public;

create or replace function public.salvar_senha_certificado_a1(
  p_certificado_id uuid,
  p_senha text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_key text;
  v_enc text;
begin
  if v_uid is null then
    raise exception 'Não autorizado.';
  end if;

  if p_senha is null or length(trim(p_senha)) = 0 then
    raise exception 'Informe a senha do certificado A1.';
  end if;

  select user_id into v_owner
  from public.empresa_certificado
  where id = p_certificado_id;

  if v_owner is null or v_owner <> v_uid then
    raise exception 'Certificado não encontrado.';
  end if;

  v_key := public.get_app_runtime_config('cert_encryption_key');
  if v_key is null or length(v_key) < 16 then
    raise exception
      'Chave de criptografia não configurada. Cadastre cert_encryption_key em app_runtime_config (SQL Editor) ou salve o certificado pela primeira vez com a API Vercel configurada (CERT_ENCRYPTION_KEY).';
  end if;

  v_enc := 'pgp1:' || encode(
    pgp_sym_encrypt(trim(p_senha), v_key, 'compress-algo=0, cipher-algo=aes256'),
    'base64'
  );

  insert into public.empresa_certificado_secreto (certificado_id, senha_criptografada)
  values (p_certificado_id, v_enc)
  on conflict (certificado_id) do update
    set senha_criptografada = excluded.senha_criptografada;
end;
$$;

revoke all on function public.salvar_senha_certificado_a1(uuid, text) from public;
grant execute on function public.salvar_senha_certificado_a1(uuid, text) to authenticated;

create or replace function public.descriptografar_senha_certificado(p_enc text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_bytes bytea;
begin
  if p_enc is null or p_enc = '' then
    raise exception 'Senha criptografada ausente.';
  end if;

  if p_enc not like 'pgp1:%' then
    raise exception 'Formato legado AES — descriptografar via API Node.';
  end if;

  v_key := public.get_app_runtime_config('cert_encryption_key');
  if v_key is null or length(v_key) < 16 then
    raise exception 'Chave de criptografia não configurada.';
  end if;

  v_bytes := decode(substring(p_enc from 6), 'base64');
  return convert_from(pgp_sym_decrypt(v_bytes, v_key), 'UTF8');
end;
$$;

revoke all on function public.descriptografar_senha_certificado(text) from public;
grant execute on function public.descriptografar_senha_certificado(text) to service_role;
