-- Código de tributação municipal (cTribMun) — até 3 dígitos, exigido por alguns municípios (ex.: Americana).
alter table public.nfe_config
  add column if not exists codigo_tributacao_municipal text not null default '';

comment on column public.nfe_config.codigo_tributacao_municipal is
  'cTribMun — código de tributação municipal (até 3 dígitos). Ex.: 001. Deixe vazio se o município não exigir.';
