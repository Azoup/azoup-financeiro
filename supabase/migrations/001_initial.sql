-- SistemaJessica — schema inicial (execute no SQL Editor do Supabase ou via CLI)

create extension if not exists "pgcrypto";

-- Tipos de ramo extensíveis
create table if not exists public.tipos_ramo (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  created_at timestamptz not null default now() -- data de criação do tipo
);

insert into public.tipos_ramo (nome)
values
  ('Confecção'),
  ('Loja'),
  ('Mercado'),
  ('Escritório'),
  ('Distribuidora'),
  ('Diversos')
on conflict (nome) do nothing;

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  documento text not null,
  nome_cliente text not null,
  nome_empresa text,
  mes_entrada text,
  valor_mensalidade numeric(12, 2),
  tipo_ramo text not null,
  data_inicio date,
  data_reajuste date,
  observacao text,
  created_at timestamptz not null default now(), -- data de criação do cadastro
  updated_at timestamptz not null default now()
);

create table if not exists public.contatos_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  nome_contato text not null,
  tipo_contato text not null check (tipo_contato in ('email', 'whatsapp')),
  valor_contato text not null,
  created_at timestamptz not null default now() -- data de criação do contato
);

create index if not exists idx_clientes_user on public.clientes (user_id);
create index if not exists idx_clientes_nome on public.clientes (nome_cliente);
create index if not exists idx_contatos_cliente on public.contatos_cliente (cliente_id);

create unique index if not exists ux_clientes_user_documento
  on public.clientes (user_id, documento);

create or replace function public.alloc_zpf_documento(p_user_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_n bigint;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'acesso negado';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select coalesce(
    max(
      (regexp_match(documento, '^ZPF - ([0-9]+)$'))[1]::bigint
    ),
    0
  ) + 1
  into next_n
  from public.clientes
  where user_id = p_user_id
    and documento ~ '^ZPF - [0-9]+$';

  return 'ZPF - ' || next_n::text;
end;
$$;

grant execute on function public.alloc_zpf_documento(uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_clientes_updated on public.clientes;
create trigger tr_clientes_updated
before update on public.clientes
for each row execute procedure public.set_updated_at();

alter table public.clientes enable row level security;
alter table public.contatos_cliente enable row level security;
alter table public.tipos_ramo enable row level security;

drop policy if exists "clientes_select_own" on public.clientes;
create policy "clientes_select_own"
  on public.clientes for select
  using (auth.uid() = user_id);

drop policy if exists "clientes_insert_own" on public.clientes;
create policy "clientes_insert_own"
  on public.clientes for insert
  with check (auth.uid() = user_id);

drop policy if exists "clientes_update_own" on public.clientes;
create policy "clientes_update_own"
  on public.clientes for update
  using (auth.uid() = user_id);

drop policy if exists "clientes_delete_own" on public.clientes;
create policy "clientes_delete_own"
  on public.clientes for delete
  using (auth.uid() = user_id);

drop policy if exists "contatos_all_own_cliente" on public.contatos_cliente;
create policy "contatos_all_own_cliente"
  on public.contatos_cliente for all
  using (
    exists (
      select 1 from public.clientes c
      where c.id = contatos_cliente.cliente_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.clientes c
      where c.id = contatos_cliente.cliente_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "tipos_ramo_read" on public.tipos_ramo;
create policy "tipos_ramo_read"
  on public.tipos_ramo for select
  to authenticated
  using (true);

drop policy if exists "tipos_ramo_insert" on public.tipos_ramo;
create policy "tipos_ramo_insert"
  on public.tipos_ramo for insert
  to authenticated
  with check (true);
