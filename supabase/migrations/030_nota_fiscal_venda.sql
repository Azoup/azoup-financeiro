-- Vincula NFS-e a vendas avulsas (além de mensalidades).

alter table public.nota_fiscal
  add column if not exists venda_id uuid references public.vendas (id) on delete set null;

create index if not exists idx_nota_fiscal_venda on public.nota_fiscal (venda_id);

comment on column public.nota_fiscal.venda_id is 'Venda avulsa de origem (nullable; mensalidade_id ou venda_id).';
