-- Notificações persistentes (ex.: retorno de clientes paralisados).

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null,
  titulo text not null,
  corpo text not null,
  chave text not null,
  lida boolean not null default false,
  alerta_exibido boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notificacoes_user_chave unique (user_id, chave)
);

create index if not exists idx_notificacoes_user_created
  on public.notificacoes (user_id, created_at desc);

create index if not exists idx_notificacoes_user_lida
  on public.notificacoes (user_id, lida)
  where lida = false;

comment on table public.notificacoes is
  'Alertas do sistema (retorno de paralisados, etc.). Permanecem no sininho.';
comment on column public.notificacoes.chave is
  'Chave idempotente por usuário (evita duplicar o mesmo evento).';
comment on column public.notificacoes.alerta_exibido is
  'true após o modal “uma vez” ter sido mostrado.';

alter table public.notificacoes enable row level security;

drop policy if exists notificacoes_select_own on public.notificacoes;
create policy notificacoes_select_own
  on public.notificacoes for select
  using (auth.uid() = user_id);

drop policy if exists notificacoes_insert_own on public.notificacoes;
create policy notificacoes_insert_own
  on public.notificacoes for insert
  with check (auth.uid() = user_id);

drop policy if exists notificacoes_update_own on public.notificacoes;
create policy notificacoes_update_own
  on public.notificacoes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists notificacoes_delete_own on public.notificacoes;
create policy notificacoes_delete_own
  on public.notificacoes for delete
  using (auth.uid() = user_id);
