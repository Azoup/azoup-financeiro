-- Tipo de faturamento do cliente (mensal | anual) e agrupamento de parcelas anuais.
-- Rode no Supabase → SQL Editor → Run.

-- ---------------------------------------------------------------------------
-- clientes
-- ---------------------------------------------------------------------------
alter table public.clientes
  add column if not exists tipo_faturamento text not null default 'mensal';

alter table public.clientes
  drop constraint if exists clientes_tipo_faturamento_check;

alter table public.clientes
  add constraint clientes_tipo_faturamento_check
  check (tipo_faturamento in ('mensal', 'anual'));

alter table public.clientes
  add column if not exists parcelas_anuais smallint;

alter table public.clientes
  drop constraint if exists clientes_parcelas_anuais_check;

alter table public.clientes
  add constraint clientes_parcelas_anuais_check
  check (
    parcelas_anuais is null
    or parcelas_anuais in (1, 2, 3, 4, 6, 12)
  );

comment on column public.clientes.tipo_faturamento is
  'mensal = 1 cobrança por geração; anual = N parcelas no ano ((mensalidade×12)/N).';
comment on column public.clientes.parcelas_anuais is
  'Quantidade de parcelas quando tipo_faturamento=anual (1,2,3,4,6,12).';

-- Anual sem parcelas → 12 por padrão
update public.clientes
set parcelas_anuais = 12
where tipo_faturamento = 'anual'
  and parcelas_anuais is null;

-- ---------------------------------------------------------------------------
-- mensalidades (parcelas do lote anual)
-- ---------------------------------------------------------------------------
alter table public.mensalidades
  add column if not exists lote_faturamento_id uuid;

alter table public.mensalidades
  add column if not exists parcela_numero smallint;

alter table public.mensalidades
  add column if not exists parcela_total smallint;

create index if not exists idx_mensalidades_lote_faturamento
  on public.mensalidades (lote_faturamento_id)
  where lote_faturamento_id is not null;

comment on column public.mensalidades.lote_faturamento_id is
  'Agrupa as N parcelas geradas juntas no faturamento anual.';
comment on column public.mensalidades.parcela_numero is
  'Número da parcela no lote (1..parcela_total).';
comment on column public.mensalidades.parcela_total is
  'Total de parcelas do lote anual.';
