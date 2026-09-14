-- Clientes ainda sem empresa passam a usar o Emitente 1.
-- Quem já tiver emitente_nf_id preenchido não é alterado.
update public.clientes c
set emitente_nf_id = e.id
from (
  select distinct on (user_id) id, user_id
  from public.nfse_emitente
  order by
    user_id,
    case when lower(trim(nome)) = 'emitente 1' then 0 else 1 end,
    created_at asc
) e
where c.emitente_nf_id is null
  and c.user_id = e.user_id;
