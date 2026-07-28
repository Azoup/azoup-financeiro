-- Mês/ano em que o cliente volta a aparecer em "Gerar mensalidades".
-- Guarda o 1º dia do mês (ex.: 2027-07-01 = julho/2027). Null = sempre elegível (legado).

alter table public.clientes
  add column if not exists proxima_geracao_mes date;

comment on column public.clientes.proxima_geracao_mes is
  '1º dia do mês em que o cliente deve reaparecer em Gerar mensalidades. Null = sem bloqueio.';
