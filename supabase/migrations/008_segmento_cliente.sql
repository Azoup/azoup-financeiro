-- Segmentos de cliente (código + nome). Em clientes grava-se apenas o código (FK).

create table if not exists public.segmento_cliente (
  codigo text primary key,
  nome text not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.segmento_cliente (codigo, nome, ordem) values
  ('PF', 'Pessoa física', 10),
  ('PJ', 'Pessoa jurídica', 20),
  ('MEI', 'MEI', 30),
  ('ASSOCIACAO', 'Associação / cooperativa', 40),
  ('DIVERSOS', 'Diversos', 99)
on conflict (codigo) do nothing;

alter table public.clientes
  add column if not exists segmento_cliente_codigo text references public.segmento_cliente (codigo);

update public.clientes
set segmento_cliente_codigo = 'DIVERSOS'
where segmento_cliente_codigo is null;

alter table public.clientes
  alter column segmento_cliente_codigo set default 'DIVERSOS';

alter table public.clientes
  alter column segmento_cliente_codigo set not null;

-- tipo_ramo deixa de ser obrigatório (legado); o app passa a usar segmento_cliente_codigo.
alter table public.clientes alter column tipo_ramo drop not null;

alter table public.segmento_cliente enable row level security;

drop policy if exists "segmento_cliente_select_authenticated" on public.segmento_cliente;
create policy "segmento_cliente_select_authenticated"
  on public.segmento_cliente for select
  to authenticated
  using (true);

comment on table public.segmento_cliente is 'Catálogo de tipo/segmento de cliente; clientes.segmento_cliente_codigo referencia codigo.';
comment on column public.clientes.segmento_cliente_codigo is 'Código do segmento (FK segmento_cliente.codigo).';
