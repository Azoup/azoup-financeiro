-- Código de tributação municipal (cTribMun) / código de serviço SP (4–5 dígitos).
-- Rode no Supabase → SQL Editor → Run.
alter table public.nfe_config
  add column if not exists codigo_tributacao_municipal text not null default '';

comment on column public.nfe_config.codigo_tributacao_municipal is
  'cTribMun (até 3 dígitos) ou código de serviço Paulistana (4–5 dígitos).';

-- Atualiza o schema cache da API (PostgREST)
notify pgrst, 'reload schema';
