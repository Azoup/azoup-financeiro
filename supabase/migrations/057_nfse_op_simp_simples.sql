-- Corrige emitentes Simples com op_simp_nac=1 (não optante).
-- Esse combo ia para o SEFIN (regime Simples) com DPS sem regApTribSN → E0039.
-- Rode no Supabase → SQL Editor → Run.

update public.nfse_emitente
set op_simp_nac = case
  when regime_tributario = 2 then 2 -- MEI
  else 3 -- ME/EPP
end
where regime_tributario in (1, 2)
  and coalesce(op_simp_nac, 1) not in (2, 3);

update public.nfe_config
set op_simp_nac = case
  when regime_tributario = 2 then 2
  else 3
end
where regime_tributario in (1, 2)
  and coalesce(op_simp_nac, 1) not in (2, 3);
