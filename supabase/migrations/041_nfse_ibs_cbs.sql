-- Campos da reforma tributária IBS/CBS para emissão de NFS-e (ADN/DPS).
-- Valores de teste 2026 conforme orientação fiscal (CST 000 / cClassTrib 000001).
-- Rode no Supabase → SQL Editor → Run.

alter table public.nfse_emitente
  add column if not exists ind_op text not null default '100501';

alter table public.nfse_emitente
  add column if not exists cst_ibs_cbs text not null default '000';

alter table public.nfse_emitente
  add column if not exists c_class_trib text not null default '000001';

alter table public.nfse_emitente
  add column if not exists aliquota_ibs_uf numeric(7, 4) not null default 0.10;

alter table public.nfse_emitente
  add column if not exists aliquota_ibs_mun numeric(7, 4) not null default 0;

alter table public.nfse_emitente
  add column if not exists aliquota_cbs numeric(7, 4) not null default 0.90;

comment on column public.nfse_emitente.ind_op is
  'Indicador da operação (IndOp) na NFS-e — ex.: 100501.';
comment on column public.nfse_emitente.cst_ibs_cbs is
  'CST IBS/CBS — ex.: 000 = tributação integral.';
comment on column public.nfse_emitente.c_class_trib is
  'cClassTrib IBS/CBS — ex.: 000001 = tributado integralmente.';
comment on column public.nfse_emitente.aliquota_ibs_uf is
  'Alíquota IBS estadual (%) — teste 2026: 0,10.';
comment on column public.nfse_emitente.aliquota_ibs_mun is
  'Alíquota IBS municipal (%) — teste 2026: 0.';
comment on column public.nfse_emitente.aliquota_cbs is
  'Alíquota CBS (%) — teste 2026: 0,90.';
