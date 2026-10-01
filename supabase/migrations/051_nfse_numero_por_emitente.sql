-- Cada CNPJ (emitente) tem a própria sequência de RPS.
-- O número 100 da Azoup pode existir ao mesmo tempo que o 100 da AZFS.

alter table public.nota_fiscal drop constraint if exists nota_fiscal_user_id_serie_numero_key;
drop index if exists public.nota_fiscal_user_id_serie_numero_key;

create unique index if not exists uq_nota_fiscal_emitente_serie_numero
  on public.nota_fiscal (user_id, emitente_id, serie, numero)
  where emitente_id is not null;

create unique index if not exists uq_nota_fiscal_serie_numero_sem_emitente
  on public.nota_fiscal (user_id, serie, numero)
  where emitente_id is null;

notify pgrst, 'reload schema';
