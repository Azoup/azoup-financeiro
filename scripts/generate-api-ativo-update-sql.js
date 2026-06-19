/**
 * Gera SQL para atualizar public.clientes a partir de "API ATIVO (1).xls".
 * Uso: node scripts/generate-api-ativo-update-sql.js [caminho.xls] [saida.sql]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SRC =
  process.argv[2] ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'API ATIVO (1).xls');
const OUT =
  process.argv[3] ||
  path.join(__dirname, '..', 'supabase', 'migrations', '025_update_clientes_api_ativo.sql');

const PLACEHOLDER_USER_ID = '00000000-0000-0000-0000-000000000000';

function sqlStr(s) {
  if (s == null) return "''";
  return `'${String(s).replace(/'/g, "''")}'`;
}

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

if (!fs.existsSync(SRC)) {
  console.error('Arquivo não encontrado:', SRC);
  process.exit(1);
}

const wb = XLSX.readFile(SRC);
const sheetName = wb.SheetNames.find((n) => /api/i.test(n)) || wb.SheetNames[0];
const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }).slice(1);

const byCnpj = new Map();
const noCnpj = [];

for (let i = 0; i < raw.length; i++) {
  const row = raw[i];
  const razao_social = String(row[2] ?? '').trim();
  const nome_fantasia = String(row[3] ?? '').trim();
  const cnpj_cadastro = String(row[4] ?? '').trim();
  const cnpj_digits = onlyDigits(cnpj_cadastro);
  const item = { line: i + 2, razao_social, nome_fantasia, cnpj_cadastro, cnpj_digits };

  if (cnpj_digits.length >= 11) {
    if (!byCnpj.has(cnpj_digits)) byCnpj.set(cnpj_digits, item);
  } else {
    noCnpj.push(item);
  }
}

const byKey = new Map();
for (const item of noCnpj) {
  const key = `${norm(item.nome_fantasia)}|${norm(item.razao_social)}`;
  if (!key.replace(/\|/g, '')) continue;
  if (!byKey.has(key)) byKey.set(key, item);
}

const staging = [...byCnpj.values(), ...byKey.values()].sort((a, b) => a.line - b.line);

const values = staging
  .map(
    (r, idx) =>
      `(${idx + 1}, ${sqlStr(r.razao_social)}, ${sqlStr(r.nome_fantasia)}, ${sqlStr(r.cnpj_cadastro)}, ${sqlStr(r.cnpj_digits)}, ${r.line})`,
  )
  .join(',\n    ');

const matchJoin = `
        (p.cnpj_digits <> '' and (
          regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') = p.cnpj_digits
          or regexp_replace(coalesce(c.documento, ''), '[^0-9]', '', 'g') = p.cnpj_digits
        ))
        or (p.nome_fantasia <> '' and lower(trim(c.nome_cliente)) = lower(trim(p.nome_fantasia)))
        or (p.razao_social <> '' and lower(trim(coalesce(c.nome_empresa, ''))) = lower(trim(p.razao_social)))
        or (p.razao_social <> '' and lower(trim(c.nome_cliente)) = lower(trim(p.razao_social)))`;

const sql = `-- Ajusta cadastros existentes em public.clientes (planilha "API ATIVO (1).xls")
-- NÃO cria tabela nova. Apenas UPDATE em public.clientes.
-- NÃO insere clientes novos — só corrige os que já existem no cadastro.
--
-- Colunas da planilha: Razão Social → nome_empresa, Nome Fantasia → nome_cliente, CPF/CNPJ → cnpj
-- ID Api é ignorado.
--
-- Match (prioridade): 1 CNPJ/CPF · 2 Nome fantasia · 3 Razão social (empresa) · 4 Razão social (nome cliente)
-- Planilha: ${raw.length} linhas · Após dedupe: ${staging.length}
--
-- ► ANTES DE RODAR:
--   select id, email from auth.users;
--   Substitua o UUID na CTE cfg abaixo (único lugar).
--   (Opcional) Troque commit por rollback no final para testar.

begin;

with
cfg as (
  select ${sqlStr(PLACEHOLDER_USER_ID)}::uuid as user_id  -- <<< COLE SEU user_id AQUI
),
planilha (staging_id, razao_social, nome_fantasia, cnpj_cadastro, cnpj_digits, linha_planilha) as (
  values
    ${values}
),
pairs as (
  select
    p.staging_id,
    p.razao_social,
    p.nome_fantasia,
    p.cnpj_cadastro,
    p.cnpj_digits,
    p.linha_planilha,
    c.id as cliente_id,
    case
      when p.cnpj_digits <> ''
        and regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') = p.cnpj_digits then 1
      when p.cnpj_digits <> ''
        and regexp_replace(coalesce(c.documento, ''), '[^0-9]', '', 'g') = p.cnpj_digits then 1
      when p.nome_fantasia <> ''
        and lower(trim(c.nome_cliente)) = lower(trim(p.nome_fantasia)) then 2
      when p.razao_social <> ''
        and lower(trim(coalesce(c.nome_empresa, ''))) = lower(trim(p.razao_social)) then 3
      when p.razao_social <> ''
        and lower(trim(c.nome_cliente)) = lower(trim(p.razao_social)) then 4
    end as match_rank
  from planilha p
  cross join cfg
  inner join public.clientes c on c.user_id = cfg.user_id
    and (${matchJoin.trim()})
),
best as (
  select distinct on (cliente_id)
    cliente_id,
    razao_social,
    nome_fantasia,
    cnpj_cadastro,
    match_rank,
    linha_planilha
  from pairs
  where match_rank is not null
  order by cliente_id, match_rank, staging_id
),
atualizados as (
  update public.clientes c
  set
    nome_cliente = coalesce(nullif(trim(b.nome_fantasia), ''), c.nome_cliente),
    nome_empresa = coalesce(nullif(trim(b.razao_social), ''), c.nome_empresa),
    cnpj = coalesce(nullif(trim(b.cnpj_cadastro), ''), c.cnpj),
    updated_at = now()
  from best b
  cross join cfg
  where c.id = b.cliente_id
    and c.user_id = cfg.user_id
  returning c.id
)
select
  (select count(*) from atualizados) as clientes_atualizados,
  (
    select count(*)
    from planilha p
    cross join cfg
    where not exists (
      select 1
      from public.clientes c
      where c.user_id = cfg.user_id
        and (${matchJoin.trim()})
    )
  ) as linhas_planilha_sem_match;

commit;

-- Pré-visualização (substitua o UUID e rode separadamente, sem commit):
/*
with cfg as (select 'SEU-UUID'::uuid as user_id),
planilha (...) as (values ...),
pairs as (... mesmo join ...)
select distinct on (c.id)
  p.linha_planilha,
  c.documento,
  c.nome_cliente,
  p.nome_fantasia as nome_novo,
  c.nome_empresa,
  p.razao_social as empresa_nova,
  c.cnpj,
  p.cnpj_cadastro as cnpj_novo
from pairs ...
order by c.id, match_rank;
*/
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sql, 'utf8');
console.log('Origem:', SRC);
console.log('Saída:', OUT);
console.log('Planilha:', raw.length, 'linhas · Dedupe:', staging.length);
