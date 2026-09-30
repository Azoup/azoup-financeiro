# Homologação Sicoob — Azoup Tecnologia LTDA

## Resposta oficial do Sicoob (importante)

> Os testes devem ser feitos em **ambiente de produção**, com um **client_id vinculado à empresa parceira**.

Isso **não** vale para o Client ID / Access Token de demonstração do Portal Developers:

| Campo (demo portal — NÃO usar na homologação) | Valor exemplo |
|-----------------------------------------------|---------------|
| Client ID | `9b5e603e428cc477a2841e2683c92d21` |
| Access token (Bearer) | `1301865f-c6bc-38f3-9f49-666dbcfc59c3` |

Esses valores só servem para brincar no sandbox público. Para liberação / evidências oficiais o Sicoob exige:

1. **Ambiente = produção** (`api.sicoob.com.br` + OAuth produção)
2. **Client ID** do aplicativo criado pelo **cooperado**, vinculado à empresa parceira **Azoup Tecnologia LTDA**
3. **Certificado A1 ICP-Brasil** (mTLS) no OAuth `client_credentials` — não o Bearer fixo do portal

## Situação da parceira

- Empresa: **Azoup Tecnologia LTDA**
- Cooperativa com liberação no Portal Developers: **5004**
- APIs liberadas na parceira: Cobrança Bancária, Cobrança Bancária Pagamentos, Conta Corrente, Pix Pagamentos, Pix Recebimentos, Poupança, SPB Transferências
- Material: https://developers.sicoob.com.br

## Passo 1 — Client ID da empresa parceira (produção)

1. Cooperado acessa https://developers.sicoob.com.br (App Sicoob / conta cooperado).
2. Cria **nova aplicação** vinculada à empresa parceira **Azoup Tecnologia LTDA**.
3. Seleciona a API **Cobrança Bancária** (V3).
4. Anota o **Client ID** gerado (esse é o que o Sicoob quer ver nas evidências).
5. Confirma **número do cliente (convênio)** e **conta corrente** de cobrança de produção.

## Passo 2 — Configurar no sistema

Em **Configurações › Boleto Sicoob**:

- Ambiente: **Produção**
- Client ID: o do app do cooperado (parceira Azoup)
- Número do cliente / convênio e conta corrente
- Certificado A1: o mesmo cadastrado em **Configurações › NFS-e** (ICP-Brasil)

O sistema já faz OAuth + mTLS em produção (`api/boleto/_lib/sicoobClient.js`).

## Passo 3 — Gerar evidências em produção

```powershell
$env:SICOOB_CLIENT_ID="(client_id do app vinculado à Azoup — NÃO o demo 9b5e...)"
$env:SICOOB_CERT_PFX_PATH="C:\caminho\certificado-a1.pfx"
$env:SICOOB_CERT_PASSWORD="(senha do A1)"
$env:SICOOB_NUMERO_CLIENTE="(convenio produção)"
$env:SICOOB_NUMERO_CONTA="(conta corrente produção)"
$env:SICOOB_AMBIENTE="producao"
# NÃO use SICOOB_ACCESS_TOKEN do portal — produção usa OAuth + A1
node scripts/gerar-evidencias-sicoob.js
```

Arquivo gerado: `sicoob-evidencias-roteiro.txt` (AT_01 autenticação, CB_01 inclusão, CB_02 consulta).

## Passo 4 — Responder o e-mail do Sicoob

Texto sugerido:

> Prezado(a), boa tarde!
>
> Agradecemos o retorno. Refaremos os testes em **ambiente de produção**, utilizando o **Client ID do aplicativo vinculado à empresa parceira Azoup Tecnologia LTDA** (cooperativa 5004), com autenticação OAuth2 `client_credentials` e certificado A1 ICP-Brasil (mTLS), conforme orientação.
>
> Em seguida encaminhamos o arquivo de evidências (`sicoob-evidencias-roteiro.txt`) com Status Code e Response Body dos testes AT_01, CB_01 e CB_02.
>
> Cordialmente,  
> Azoup Tecnologia LTDA — SistemaJessica / Azoup Financeiro

Anexar depois:

1. `sicoob-evidencias-roteiro.txt` com o Client ID parceiro (não o demo)
2. Razão social, software, cooperativa 5004, Client ID usado, confirmação do A1 ICP-Brasil

## O que já está no sistema

- API Cobrança Bancária V3 (inclusão, consulta, baixa)
- Tela **Configurações › Boleto Sicoob** (ambiente produção + Client ID)
- Emissão na geração de mensalidade
- Script `scripts/gerar-evidencias-sicoob.js`
