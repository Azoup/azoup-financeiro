-- Campos fiscais extras para emitente em Regime Normal (Lucro Presumido / Lucro Real).
-- Rode no Supabase → SQL Editor → Run.

alter table public.nfse_emitente
  add column if not exists tipo_apuracao text
    check (tipo_apuracao is null or tipo_apuracao in ('presumido', 'real'));

alter table public.nfse_emitente
  add column if not exists codigo_cnae text not null default '';

alter table public.nfse_emitente
  add column if not exists situacao_pis_cofins text not null default '00';

alter table public.nfse_emitente
  add column if not exists aliquota_iss numeric(7, 4) not null default 0;

alter table public.nfse_emitente
  add column if not exists aliquota_pis numeric(7, 4) not null default 0;

alter table public.nfse_emitente
  add column if not exists aliquota_cofins numeric(7, 4) not null default 0;

comment on column public.nfse_emitente.tipo_apuracao is
  'Apuração IRPJ quando regime_tributario=3 (Normal): presumido | real. Null no Simples.';
comment on column public.nfse_emitente.codigo_cnae is
  'CNAE principal do prestador (7 dígitos) — usado na NFS-e ABRASF.';
comment on column public.nfse_emitente.situacao_pis_cofins is
  'Código SituacaoTributariaPISCOFINS (TipLan/ABRASF), ex.: 00, 01, 02…';
comment on column public.nfse_emitente.aliquota_iss is
  'Alíquota ISS (%) quando tributável (Regime Normal).';

-- Emitentes já em Regime Normal sem apuração → Lucro Presumido por padrão
update public.nfse_emitente
set tipo_apuracao = 'presumido'
where regime_tributario = 3
  and (tipo_apuracao is null or trim(tipo_apuracao) = '');
