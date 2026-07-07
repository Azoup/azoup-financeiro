-- Permite opSimpNac = 4 (Optante pendente — NT 009 NFS-e)
alter table public.nfe_config drop constraint if exists nfe_config_op_simp_nac_check;
alter table public.nfe_config
  add constraint nfe_config_op_simp_nac_check check (op_simp_nac in (1, 2, 3, 4));
