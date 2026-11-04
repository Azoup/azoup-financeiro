# NFS-e Simples no SEFIN (ADN) — o que ajustamos para emitir

Checklist prático para quem está com rejeição no **Emissor Nacional (SEFIN / ADN)** em município TipLan (ex.: Americana/SP), optante do **Simples Nacional**, competência **≥ 11/2026**.

Baseado no que estabilizou a emissão no Azoup (produção oficial, NT 004/007).

---

## Contexto

- Optantes do Simples (MEI / ME-EPP) passam a emitir pelo **Emissor Nacional**, não pelo webservice municipal TipLan (que devolve **L999**).
- No SEFIN “público”, município TipLan costuma devolver **E0039** se faltar o regime correto na DPS.
- XML de referência autorizado: processado por `SefinNacional_1.6.0`, com `opSimpNac=3` + `regApTribSN=1` (sem IM no prestador).

---

## 1. Roteamento (gateway)

| Situação | Para onde enviar |
|----------|------------------|
| Americana + **Regime Normal** | ABRASF TipLan (SOAP municipal) |
| Americana + **Simples** (MEI/ME-EPP) | **SEFIN Nacional** (ADN) — **sem** URL da API municipal |
| Demais municípios aderentes | SEFIN Nacional |

**Não** redirecionar Simples para `nfse.americana.sp.gov.br/api/adn/...` tentando “fugir” do E0039. O caminho certo é SEFIN + DPS correta.

- Competência ≥ `2026-11`: pode pular `ConsultarConvenio` / parametrização antiga do município para Simples (`skipConvenioNacional`).

---

## 2. `prest.regTrib` (E0039 + E1235)

### Obrigatório para Simples no SEFIN

```xml
<regTrib>
  <opSimpNac>3</opSimpNac>      <!-- 2=MEI, 3=ME/EPP -->
  <regApTribSN>1</regApTribSN>  <!-- indispensável para E0039 -->
  <regEspTrib>0</regEspTrib>
</regTrib>
```

### Ordem das tags (E1235)

O XSD `TCRegTrib` exige:

1. `opSimpNac`
2. `regApTribSN` (se houver)
3. `regEspTrib`

Se a lib serializa JSON→XML **na ordem das chaves** (ex.: xml2js), **não** faça:

```js
// ERRADO — gera E1235
regTrib = { opSimpNac: 3, regEspTrib: 0 };
regTrib.regApTribSN = 1; // fica no FINAL do objeto
```

Faça:

```js
// CERTO
regTrib = {
  opSimpNac: 3,
  regApTribSN: 1,
  regEspTrib: 0,
};
```

Cadastro: `op_simp_nac` = **3** (ME/EPP) ou **2** (MEI), não “não optante”.

---

## 3. Sem `finNFSe` na raiz do `infDPS` (E1235)

Produção oficial ainda é **NT 004/007**.

- **Não** colocar `<finNFSe>` como filho direto de `infDPS`.
- NT 009 (`finNFSe` na raiz) ainda não é produção plena → **E1235**.

---

## 4. Sem grupo `IBSCBS` via montagem “genérica” (E1235)

Emissores que geram **XML cru** podem mandar `IBSCBS` completo no fim do `infDPS` e autorizar.

Com libs tipo **@nfewizard** (JSON → XML), o grupo costuma sair **inválido** no schema de produção → **E1235**.

No Azoup: **omitimos `IBSCBS`** na DPS nacional. O ADN aceita omissão (grupo opcional nesse leiaute).

Se for mandar `IBSCBS` no futuro, tem que ser XML fiel ao schema (irmão de `valores`, com `finNFSe`/`indFinal`/`cIndOp`/`indDest`/`gIBSCBS`), nunca dentro de `valores/trib`.

---

## 5. Sem `IM` no prestador no SEFIN (E0120)

```
E0120 — IM do prestador não deve ser informado...
```

No caminho **SEFIN nacional**, **não envie** `<IM>` em `prest`.

- XML autorizado de referência também vinha **sem IM**.
- Guarde a IM no cadastro para **TipLan/ABRASF** (Regime Normal); só não coloque na DPS do ADN.

```js
prest: {
  CNPJ: '...',
  // sem IM
  regTrib: { ... },
}
```

---

## 6. `endNac` — ordem `cMun` → `CEP` (E1235)

XSD `TCEnderNac`:

```xml
<endNac>
  <cMun>3501608</cMun>
  <CEP>13466360</CEP>
</endNac>
```

Não inverter (`CEP` antes de `cMun`) se a serialização preservar ordem das chaves.

---

## 7. Forma mínima da DPS (Simples / SEFIN / NT 004)

Campos essenciais (sem `finNFSe` raiz, sem `IBSCBS`, sem `IM`):

```text
infDPS
  tpAmb, dhEmi, verAplic, serie, nDPS, dCompet, tpEmit, cLocEmi
  prest
    CNPJ (ou CPF)
    regTrib: opSimpNac → regApTribSN → regEspTrib
  toma
    documento, xNome
    end / endNac: cMun → CEP
    xLgr, nro, xBairro
  serv
    locPrest/cLocPrestacao
    cServ: cTribNac, (cTribMun se houver), xDescServ, cNBS
  valores
    vServPrest/vServ
    trib/tribMun + totTrib
```

---

## 8. Erros que vimos e o que resolveu

| Código | Sintoma | Correção |
|--------|---------|----------|
| **L999** | TipLan: Simples só no Emissor Nacional | Rotear Simples → SEFIN |
| **E0039** | Município não parametrizado para emissores públicos | `opSimpNac` 2/3 + `regApTribSN=1` + competência ≥ 11/2026 + SEFIN |
| **E1235** | XML fora do schema | Sem `finNFSe` raiz; sem `IBSCBS` malformado; **ordem** `regTrib` e `endNac` |
| **E0120** | IM não deve ser informada | Omitir `IM` na DPS do SEFIN |

Mensagens “amigáveis” no app às vezes são genéricas (ex.: E1235 falando de `finNFSe` mesmo quando o problema é ordem de tags). Confira o **detalhe bruto** do ADN / log do XML gerado.

---

## 9. Checklist rápido antes de reemitir

1. [ ] Emitente Simples com `opSimpNac` = 2 ou 3  
2. [ ] DPS com `regApTribSN=1` **antes** de `regEspTrib`  
3. [ ] Gateway = SEFIN nacional (não TipLan, não API municipal ADN)  
4. [ ] Competência ≥ novembro/2026  
5. [ ] Sem `finNFSe` na raiz de `infDPS`  
6. [ ] Sem `IBSCBS` (ou XML 100% conforme schema)  
7. [ ] Sem `IM` em `prest` no SEFIN  
8. [ ] `endNac`: `cMun` depois `CEP`  
9. [ ] CNPJ do certificado A1 habilitado no portal nacional (gov.br/nfse)  
10. [ ] Redeploy da API depois das mudanças; reemitir a nota rejeitada (número/RPS novo se o ADN já gravou tentativa)

---

## 10. Referência de commits (Azoup)

Ordem aproximada do que estabilizou:

1. Simples → SEFIN + `regApTribSN`  
2. Remoção de `IBSCBS` / `finNFSe` inválidos (E1235)  
3. Ordem correta `TCRegTrib` / `TCEnderNac`  
4. Omitir `IM` (E0120)

Repo: ajustes em `api/nfe/_lib/buildNFSeFromDb.js`, `nfseGateways.js`, `nfseEmit.js`, `nfseErrors.js`.

---

## Observação

Outro sistema pode autorizar com `IBSCBS` completo em XML próprio. O ponto crítico não é “copiar o XML de outro emissor cegamente”, e sim:

1. **mesmo gateway** (SEFIN),  
2. **mesmos campos obrigatórios do Simples** (`regApTribSN`),  
3. **schema de produção** (ordem + o que não pode ir: `finNFSe` raiz, `IM`, `IBSCBS` quebrado).
