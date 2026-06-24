-- Campos auxiliares para baixa automática Sicoob.

alter table public.boletos_parcela_venda
  add column if not exists data_liquidacao_sicoob date,
  add column if not exists ultima_consulta_sicoob timestamptz;

alter table public.config_sicoob
  add column if not exists webhook_token text;

comment on column public.config_sicoob.webhook_token is
  'Token opcional para validar POST /api/boleto/webhook-sicoob (header x-sicoob-webhook-token).';

create index if not exists idx_boletos_parc_sicoob_pendentes
  on public.boletos_parcela_venda (status_registro, data_vencimento)
  where tipo_emissao = 'sicoob' and status_registro = 'registrado';
