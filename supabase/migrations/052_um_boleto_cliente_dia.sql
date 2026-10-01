-- Um boleto por cliente em cada dia de vencimento.
-- Carnê baixado ou mensalidade cancelada não ocupam o dia.

create or replace function public.bloquear_segundo_boleto_cliente_dia()
returns trigger
language plpgsql
as $$
declare
  v_cliente uuid;
  v_dia date;
  v_outros int;
begin
  if coalesce(new.status_registro, '') = 'baixado' then
    return new;
  end if;

  v_dia := new.data_vencimento;

  if new.mensalidade_id is not null then
    select m.cliente_id into v_cliente
    from public.mensalidades m
    where m.id = new.mensalidade_id
      and m.status <> 'cancelado';
  elsif new.venda_id is not null then
    select v.cliente_id into v_cliente
    from public.vendas v
    where v.id = new.venda_id;
  end if;

  if v_cliente is null then
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
    and coalesce(m.cliente_id, v.cliente_id) = v_cliente
    and (b.mensalidade_id is null or m.status is distinct from 'cancelado');

  if v_outros > 0 then
    raise exception 'Este cliente já tem boleto neste dia.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists tr_um_boleto_cliente_dia on public.boletos_parcela_venda;
create trigger tr_um_boleto_cliente_dia
before insert on public.boletos_parcela_venda
for each row execute procedure public.bloquear_segundo_boleto_cliente_dia();

create or replace function public.bloquear_segunda_mensalidade_cliente_dia()
returns trigger
language plpgsql
as $$
declare
  v_outros int;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select count(*) into v_outros
  from public.mensalidades m
  where m.user_id = new.user_id
    and m.cliente_id = new.cliente_id
    and m.data_vencimento = new.data_vencimento
    and m.status <> 'cancelado'
    and m.id is distinct from new.id;

  if v_outros > 0 then
    raise exception 'Este cliente já tem boleto neste dia.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists tr_uma_mensalidade_cliente_dia on public.mensalidades;
create trigger tr_uma_mensalidade_cliente_dia
before insert on public.mensalidades
for each row execute procedure public.bloquear_segunda_mensalidade_cliente_dia();
