-- Cliente com nota fiscal (NF) ou sem NF (cadastro / operação).
alter table public.clientes
  add column if not exists emite_nf boolean not null default false;

comment on column public.clientes.emite_nf is
  'true = cliente com NF (emite ou exige nota fiscal); false = sem NF.';
