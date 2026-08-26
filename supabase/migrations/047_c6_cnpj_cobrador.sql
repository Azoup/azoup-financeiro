-- CNPJ cobrador C6 (portal Developers): 05.320.214/0001-69
update public.nfse_emitente
set banco_cobranca = 'c6'
where regexp_replace(coalesce(documento, ''), '\D', '', 'g') = '05320214000169';
