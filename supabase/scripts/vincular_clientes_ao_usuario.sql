-- Vincula todos os clientes sem user_id ao seu usuário do Supabase Auth.
-- Rode no SQL Editor do Supabase (substitua o e-mail se necessário).

-- 1) Ver quantos clientes estão sem dono:
select count(*) as orfaos from public.clientes where user_id is null;

-- 2) Ver seu UUID (use o e-mail com que faz login no app):
select id, email from auth.users order by created_at;

-- 3) Vincular ao usuário logado (via função da migration 028):
select public.vincular_clientes_orfaos();

-- OU, manualmente com o UUID:
-- update public.clientes
-- set user_id = '00000000-0000-0000-0000-000000000000',
--     updated_at = now()
-- where user_id is null;

-- 4) Conferir:
select user_id, count(*) from public.clientes group by user_id;
