-- Reparo idempotente se a 018 falhou no meio (ex.: erro ao dropar índice/constraint de parcela_id).
-- Pode rodar várias vezes sem problema.

alter table public.boletos_parcela_venda
  add column if not exists mensalidade_id uuid references public.mensalidades (id) on delete cascade,
  add column if not exists origem text;

update public.boletos_parcela_venda
set origem = 'venda'
where origem is null;

alter table public.boletos_parcela_venda
  alter column origem set default 'venda',
  alter column origem set not null;

alter table public.boletos_parcela_venda
  drop constraint if exists boletos_parcela_venda_origem_check;

alter table public.boletos_parcela_venda
  add constraint boletos_parcela_venda_origem_check
  check (origem in ('venda', 'mensalidade'));

alter table public.boletos_parcela_venda
  alter column venda_id drop not null,
  alter column parcela_id drop not null;

alter table public.boletos_parcela_venda
  drop constraint if exists boletos_parcela_venda_parcela_id_key;

drop index if exists boletos_parcela_venda_parcela_id_key;

create unique index if not exists uq_boletos_parc_parcela_id
  on public.boletos_parcela_venda (parcela_id)
  where parcela_id is not null;

create unique index if not exists uq_boletos_parc_mensalidade_id
  on public.boletos_parcela_venda (mensalidade_id)
  where mensalidade_id is not null;

alter table public.boletos_parcela_venda
  drop constraint if exists chk_boletos_parc_origem;

alter table public.boletos_parcela_venda
  add constraint chk_boletos_parc_origem check (
    (
      origem = 'venda'
      and venda_id is not null
      and parcela_id is not null
      and mensalidade_id is null
    )
    or (
      origem = 'mensalidade'
      and mensalidade_id is not null
      and venda_id is null
      and parcela_id is null
    )
  );

create index if not exists idx_boletos_parc_mensalidade on public.boletos_parcela_venda (mensalidade_id);
