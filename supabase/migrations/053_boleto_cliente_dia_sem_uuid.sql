-- A trava de um boleto por dia gravava o cliente numa variável uuid.
-- Cliente com código numérico (ex.: 991) derrubava o carnê inteiro:
-- invalid input syntax for type uuid: "991"
-- Mensalidade e NFS-e não passam por essa variável, por isso só o boleto falhava.
-- Rode no Supabase → SQL Editor → Run. Pode rodar de novo sem problema.

create or replace function public.bloquear_segundo_boleto_cliente_dia()
returns trigger
language plpgsql
as $$
declare
  v_cliente text;
  v_dia date;
  v_outros int;
begin
  if coalesce(new.status_registro, '') = 'baixado' then
    return new;
  end if;

  v_dia := new.data_vencimento;

  if new.mensalidade_id is not null then
    select m.cliente_id::text into v_cliente
    from public.mensalidades m
    where m.id = new.mensalidade_id
      and m.status <> 'cancelado';
  elsif new.venda_id is not null then
    select v.cliente_id::text into v_cliente
    from public.vendas v
    where v.id = new.venda_id;
  end if;

  if v_cliente is null or v_cliente = '' then
    return new;
  end if;

  select count(*) into v_outros
  from public.boletos_parcela_venda b
  left join public.mensalidades m on m.id = b.mensalidade_id
  left join public.vendas v on v.id = b.venda_id
  where b.user_id = new.user_id
    and b.id is distinct from new.id
    and b.data_vencimento = v_dia
    and coalesce(b.status_registro, '') <> 'baixado'
    and coalesce(m.cliente_id::text, v.cliente_id::text) = v_cliente
    and (b.mensalidade_id is null or m.status is distinct from 'cancelado');

  if v_outros > 0 then
    raise exception 'Este cliente já tem boleto neste dia.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;
