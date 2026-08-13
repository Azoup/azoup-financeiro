-- PIX C6 + campos de conciliação no carnê/boleto.

alter table public.boletos_parcela_venda
  add column if not exists pix_txid text,
  add column if not exists pix_copia_cola text,
  add column if not exists pix_location text,
  add column if not exists pix_status text,
  add column if not exists pix_criado_em timestamptz;

create index if not exists idx_boletos_parc_pix_txid
  on public.boletos_parcela_venda (pix_txid)
  where pix_txid is not null;

comment on column public.boletos_parcela_venda.pix_txid is
  'Txid da cobrança Pix C6 (cob/cobv) vinculada ao documento.';
comment on column public.boletos_parcela_venda.pix_copia_cola is
  'EMV / Pix Copia e Cola retornado pela API C6.';
