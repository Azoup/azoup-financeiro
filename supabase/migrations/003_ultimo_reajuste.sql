-- Data do último reajuste (valor anterior de data_reajuste quando esta é alterada)
alter table public.clientes add column if not exists ultimo_reajuste date;
