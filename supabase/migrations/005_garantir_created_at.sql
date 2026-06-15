-- Garante coluna de data/hora de criação (created_at) em todas as tabelas de negócio
-- e impede que updates alterem essa data (só o default no INSERT define o valor inicial).

alter table public.clientes
  add column if not exists created_at timestamptz not null default now();

alter table public.contatos_cliente
  add column if not exists created_at timestamptz not null default now();

alter table public.tipos_ramo
  add column if not exists created_at timestamptz not null default now();

-- Registros antigos sem data (se a coluna já existia como nullable)
update public.clientes
set created_at = coalesce(created_at, updated_at, now())
where created_at is null;

update public.contatos_cliente
set created_at = coalesce(created_at, now())
where created_at is null;

update public.tipos_ramo
set created_at = coalesce(created_at, now())
where created_at is null;

-- Manter created_at imutável em UPDATEs
create or replace function public.preserve_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists tr_clientes_preserve_created_at on public.clientes;
create trigger tr_clientes_preserve_created_at
before update on public.clientes
for each row execute procedure public.preserve_created_at();

drop trigger if exists tr_contatos_preserve_created_at on public.contatos_cliente;
create trigger tr_contatos_preserve_created_at
before update on public.contatos_cliente
for each row execute procedure public.preserve_created_at();

drop trigger if exists tr_tipos_ramo_preserve_created_at on public.tipos_ramo;
create trigger tr_tipos_ramo_preserve_created_at
before update on public.tipos_ramo
for each row execute procedure public.preserve_created_at();
