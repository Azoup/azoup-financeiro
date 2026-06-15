-- Vendas: vários itens de descrição (lista). `descricao` continua como texto agregado (busca e legado).

alter table public.vendas add column if not exists itens_descricao jsonb;

comment on column public.vendas.itens_descricao is
  'JSON array de strings (2+ itens). Null = apenas `descricao` como texto único.';
