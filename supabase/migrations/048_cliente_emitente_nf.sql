-- Empresa (emitente NFS-e) que emite a nota do cliente.
alter table public.clientes
  add column if not exists emitente_nf_id uuid references public.nfse_emitente (id) on delete set null;

create index if not exists idx_clientes_emitente_nf
  on public.clientes (emitente_nf_id)
  where emitente_nf_id is not null;

comment on column public.clientes.emitente_nf_id is
  'Emitente NFS-e (Configurações) que emite a nota deste cliente.';
