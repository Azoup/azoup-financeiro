-- Cliente pode ser marcado como cancelado (mantém histórico; não entra em totais ativos)
alter table public.clientes add column if not exists cancelado boolean not null default false;

comment on column public.clientes.cancelado is
  'Quando true, o cliente é tratado como cancelado (ex.: não entra na soma do painel).';
