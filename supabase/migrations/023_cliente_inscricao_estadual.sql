-- Inscrição estadual do cliente (tomador PJ na NFS-e / boletos).

alter table public.clientes
  add column if not exists inscricao_estadual text not null default '';

comment on column public.clientes.inscricao_estadual is 'Inscrição estadual do cliente (IE). Vazio ou ISENTO quando não aplicável.';
