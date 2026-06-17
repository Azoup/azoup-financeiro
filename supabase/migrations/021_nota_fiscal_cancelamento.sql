-- Campos de cancelamento NF-e na SEFAZ

alter table public.nota_fiscal
  add column if not exists motivo_cancelamento text,
  add column if not exists data_cancelamento timestamptz;

comment on column public.nota_fiscal.motivo_cancelamento is 'Justificativa enviada no evento de cancelamento (mín. 15 caracteres).';
