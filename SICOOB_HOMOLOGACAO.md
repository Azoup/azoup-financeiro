# Homologação Sicoob — Azoup Tecnologia LTDA

Passos oficiais (e-mail Sicoob) e o que já está pronto no **SistemaJessica / Azoup Financeiro**.

## Situação da parceira

- Empresa: **Azoup Tecnologia LTDA**
- Cooperativa com liberação no Portal Developers: **5004**
- APIs liberadas na parceira: Cobrança Bancária, Cobrança Bancária Pagamentos, Conta Corrente, Pix Pagamentos, Pix Recebimentos, Poupança, SPB Transferências
- Material: https://developers.sicoob.com.br

## O que a integradora (Azoup) já tem no sistema

- Integração **API Cobrança Bancária V3** (`api/boleto/_lib/sicoobClient.js`)
  - OAuth2 `client_credentials` + certificado A1 (mTLS)
  - `POST /boletos` (inclusão)
  - `GET /boletos` (consulta / liquidação)
  - Header `client_id` nas chamadas da API
- Tela **Configurações › Boleto Sicoob**
- Emissão na geração de mensalidade (escolha Sicoob ou C6)
- Script de evidências: `node scripts/gerar-evidencias-sicoob.js`
- Arquivo gerado: `sicoob-evidencias-roteiro.txt`

## Passo 1 — Portal Developers (cooperado indicado)

1. Cooperado acessa https://developers.sicoob.com.br (App Sicoob / conta cooperado).
2. Cria **nova aplicação** vinculada à empresa parceira **Azoup Tecnologia LTDA**.
3. Seleciona a API **Cobrança Bancária** (V3).
4. Anota o **Client ID** gerado.
5. No sandbox do portal, copia o **Access Token** de teste (ou usa certificado A1 ICP-Brasil do cooperado/software house para OAuth).
6. Confirma **número do cliente (convênio)** e **conta corrente** de cobrança usados nos testes.

## Passo 2 — Rodar evidências com as credenciais reais

No PowerShell (na pasta do projeto):

```powershell
$env:SICOOB_CLIENT_ID="(client_id do app criado)"
$env:SICOOB_ACCESS_TOKEN="(token sandbox do portal)"   # OU use .pfx abaixo
$env:SICOOB_NUMERO_CLIENTE="(convenio)"
$env:SICOOB_NUMERO_CONTA="(conta corrente)"
$env:SICOOB_AMBIENTE="sandbox"
# Alternativa OAuth + certificado:
# $env:SICOOB_CERT_PFX_PATH="C:\caminho\certificado.pfx"
# $env:SICOOB_CERT_PASSWORD="senha"
node scripts/gerar-evidencias-sicoob.js
```

Isso atualiza `sicoob-evidencias-roteiro.txt` com Status Code + Response Body de:

| Código | Teste |
|--------|--------|
| AT_01 | Autenticação (token / OAuth mTLS) |
| CB_01 | Inclusão de boleto `POST /boletos` |
| CB_02 | Consulta `GET /boletos` |

## Passo 3 — Enviar ao Sicoob (feedback / liberação nacional)

Anexar ou colar no e-mail:

1. `sicoob-evidencias-roteiro.txt` (com **credenciais do app do cooperado**, não só o demo público)
2. Informar:
   - Razão social: Azoup Tecnologia LTDA
   - Software: SistemaJessica / Azoup Financeiro
   - Cooperativa: 5004
   - Client ID do aplicativo de teste
   - Confirmação de que o certificado usado é ICP-Brasil (quando OAuth/mTLS)

Texto sugerido:

> Segue evidências dos testes de autenticação e consumo da API Cobrança Bancária V3 realizados com o aplicativo criado pelo cooperado vinculado à Azoup Tecnologia LTDA (cooperativa 5004). Solicitamos a liberação da empresa em rede nacional para que demais cooperativas possam criar credenciais usando a Azoup como vetor da integração.

## Nota sobre o sandbox público

O token/client_id de demonstração do portal responde **consulta (GET)** com mock 200, mas a **inclusão (POST)** costuma devolver 400 com payload placeholder (`mensagem: "string"`).  
Para a liberação nacional o Sicoob exige evidências com as **credenciais do aplicativo do cooperado** vinculado à Azoup.
