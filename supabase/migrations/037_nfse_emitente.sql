-- Até 2 emitentes NFS-e por usuário (CNPJ + fiscal + A1 próprios).
-- Rode no Supabase → SQL Editor → Run.

-- ---------------------------------------------------------------------------
-- Tabela nfse_emitente
-- ---------------------------------------------------------------------------
create table if not exists public.nfse_emitente (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nome text not null default 'Emitente',
  documento text not null default '',
  razao_social text not null default '',
  logradouro text not null default '',
  numero text not null default '',
  complemento text not null default '',
  bairro text not null default '',
  cidade text not null default '',
  uf text not null default '',
  cep text not null default '',
  serie text not null default '1',
  proximo_numero integer not null default 1 check (proximo_numero >= 1),
  ambiente smallint not null default 1 check (ambiente in (1, 2)),
  inscricao_estadual text not null default '',
  regime_tributario smallint not null default 1 check (regime_tributario in (1, 2, 3)),
  codigo_ibge_emitente text not null default '',
  inscricao_municipal text not null default '',
  ncm_servico text not null default '00000000',
  cfop_padrao text not null default '5933',
  cst_icms text not null default '102',
  csosn text not null default '102',
  descricao_servico_padrao text not null default 'Serviço de mensalidade',
  natureza_operacao text not null default 'Prestação de serviço',
  codigo_tributacao_nacional text not null default '010701',
  codigo_tributacao_municipal text not null default '',
  codigo_nbs text not null default '115013000',
  op_simp_nac smallint not null default 3 check (op_simp_nac in (1, 2, 3, 4)),
  reg_esp_trib smallint not null default 0 check (reg_esp_trib between 0 and 9),
  trib_issqn smallint not null default 1 check (trib_issqn in (1, 2, 3, 4)),
  tp_ret_issqn smallint not null default 1 check (tp_ret_issqn in (1, 2, 3)),
  padrao boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, documento)
);

create index if not exists idx_nfse_emitente_user on public.nfse_emitente (user_id);

-- No máximo 1 emitente padrão por usuário
create unique index if not exists uq_nfse_emitente_user_padrao
  on public.nfse_emitente (user_id)
  where padrao = true;

-- Máximo 2 emitentes por usuário
create or replace function public.nfse_emitente_limit_2()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*) from public.nfse_emitente e
    where e.user_id = new.user_id
      and (tg_op = 'INSERT' or e.id is distinct from new.id)
  ) >= 2 then
    raise exception 'Máximo de 2 emitentes NFS-e por usuário.';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_nfse_emitente_limit_2 on public.nfse_emitente;
create trigger tr_nfse_emitente_limit_2
before insert on public.nfse_emitente
for each row execute procedure public.nfse_emitente_limit_2();

drop trigger if exists tr_nfse_emitente_updated on public.nfse_emitente;
create trigger tr_nfse_emitente_updated
before update on public.nfse_emitente
for each row execute procedure public.set_updated_at();

alter table public.nfse_emitente enable row level security;

drop policy if exists "nfse_emitente_own" on public.nfse_emitente;
create policy "nfse_emitente_own" on public.nfse_emitente for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Certificado vinculado ao emitente
-- ---------------------------------------------------------------------------
alter table public.empresa_certificado
  add column if not exists emitente_id uuid references public.nfse_emitente (id) on delete set null;

drop index if exists public.uq_empresa_certificado_user_ativo;

create unique index if not exists uq_empresa_certificado_emitente_ativo
  on public.empresa_certificado (emitente_id)
  where ativo = true and emitente_id is not null;

-- Fallback legado: no máximo 1 ativo sem emitente_id por usuário
create unique index if not exists uq_empresa_certificado_user_ativo_legado
  on public.empresa_certificado (user_id)
  where ativo = true and emitente_id is null;

-- ---------------------------------------------------------------------------
-- Nota fiscal → emitente
-- ---------------------------------------------------------------------------
alter table public.nota_fiscal
  add column if not exists emitente_id uuid references public.nfse_emitente (id) on delete set null;

create index if not exists idx_nota_fiscal_emitente on public.nota_fiscal (emitente_id);

-- ---------------------------------------------------------------------------
-- Seed: 1 emitente a partir de perfil_cobranca + nfe_config
-- ---------------------------------------------------------------------------
insert into public.nfse_emitente (
  user_id, nome, documento, razao_social,
  logradouro, numero, complemento, bairro, cidade, uf, cep,
  serie, proximo_numero, ambiente,
  inscricao_estadual, regime_tributario,
  codigo_ibge_emitente, inscricao_municipal,
  ncm_servico, cfop_padrao, cst_icms, csosn,
  descricao_servico_padrao, natureza_operacao,
  codigo_tributacao_nacional, codigo_tributacao_municipal, codigo_nbs,
  op_simp_nac, reg_esp_trib, trib_issqn, tp_ret_issqn,
  padrao
)
select
  coalesce(c.user_id, p.user_id),
  'Emitente 1',
  coalesce(nullif(trim(p.documento), ''), 'PENDENTE-' || coalesce(c.user_id, p.user_id)::text),
  coalesce(nullif(trim(p.razao_social), ''), 'Prestador'),
  coalesce(p.logradouro, ''),
  coalesce(p.numero, ''),
  coalesce(p.complemento, ''),
  coalesce(p.bairro, ''),
  coalesce(p.cidade, ''),
  coalesce(p.uf, ''),
  coalesce(p.cep, ''),
  coalesce(c.serie, '1'),
  coalesce(c.proximo_numero, 1),
  coalesce(c.ambiente, 1),
  coalesce(c.inscricao_estadual, ''),
  coalesce(c.regime_tributario, 1),
  coalesce(c.codigo_ibge_emitente, ''),
  coalesce(c.inscricao_municipal, ''),
  coalesce(c.ncm_servico, '00000000'),
  coalesce(c.cfop_padrao, '5933'),
  coalesce(c.cst_icms, '102'),
  coalesce(c.csosn, '102'),
  coalesce(c.descricao_servico_padrao, 'Serviço de mensalidade'),
  coalesce(c.natureza_operacao, 'Prestação de serviço'),
  coalesce(c.codigo_tributacao_nacional, '010701'),
  coalesce(c.codigo_tributacao_municipal, ''),
  coalesce(c.codigo_nbs, '115013000'),
  coalesce(c.op_simp_nac, 3),
  coalesce(c.reg_esp_trib, 0),
  coalesce(c.trib_issqn, 1),
  coalesce(c.tp_ret_issqn, 1),
  true
from public.nfe_config c
full outer join public.perfil_cobranca p on p.user_id = c.user_id
where coalesce(c.user_id, p.user_id) is not null
  and not exists (
    select 1 from public.nfse_emitente e
    where e.user_id = coalesce(c.user_id, p.user_id)
  );

-- Vincular certificados ativos ao emitente padrão do usuário
update public.empresa_certificado ec
set emitente_id = e.id
from public.nfse_emitente e
where e.user_id = ec.user_id
  and e.padrao = true
  and ec.ativo = true
  and ec.emitente_id is null;

-- Backfill notas
update public.nota_fiscal n
set emitente_id = e.id
from public.nfse_emitente e
where e.user_id = n.user_id
  and e.padrao = true
  and n.emitente_id is null;

comment on table public.nfse_emitente is
  'Emitente NFS-e (até 2 por usuário): CNPJ, endereço, parâmetros fiscais e vínculo com A1.';
comment on column public.nota_fiscal.emitente_id is
  'Emitente (CNPJ) usado na emissão desta NFS-e.';

notify pgrst, 'reload schema';
