# Carteira de Investimentos

Painel web para acompanhamento de carteira de ações e FIIs da B3, com cálculo de dividendos por data COM e suporte a múltiplos lançamentos por ativo.

## Funcionalidades

- Cadastro de compras por ativo com data, quantidade e preço
- Cálculo automático de dividendos respeitando a data COM de cada provento
- Preços em tempo real via Brapi.dev
- Expansão por lote com edição e remoção
- Painel admin para gestão de ativos e dividendos

## Tecnologias

| Tecnologia | Motivo |
|---|---|
| **.NET 9 (ASP.NET Core)** | API com arquitetura em camadas (Domain / Application / Infrastructure) |
| **PostgreSQL 16** | Banco relacional robusto, em container Docker |
| **Vanilla JS** | Sem dependência de framework — projeto pequeno, sem necessidade de React/Vue |
| **Brapi.dev** | API gratuita e completa com dados de ações e FIIs brasileiros |

## Pré-requisitos

- **Docker Desktop**
- **.NET 9 SDK** (apenas para rodar a API fora do Docker)

## Configuração (segredos)

Nenhum segredo fica no git. Todos vivem no arquivo **`.env`** na raiz do projeto, que já está no `.gitignore`:

```bash
copy .env.example .env     # Windows
```

Depois preencha o `JWT_SECRET` (obrigatório, mínimo de 32 caracteres) e, se quiser, `BRAPI_TOKEN` e `GOOGLE_API_KEY`:

```bash
powershell -NoProfile -File scripts/gerar-jwt-secret.ps1 -Aplicar
```

| Variável | Para quê |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Banco no Docker |
| `JWT_SECRET` | Assinatura dos tokens de login (trocar desloga todos) |
| `BRAPI_TOKEN` | Cotações e importação de ações |
| `GOOGLE_API_KEY` | Leitura da planilha de preços (fica no servidor, não no navegador) |
| `ConnectionStrings__DefaultConnection` | Só para `dotnet run` fora do Docker |

A aplicação falha na inicialização se o `JWT_SECRET` estiver ausente ou curto demais.

## Como rodar

```bash
deploy.bat            # Windows: build + restart
```

ou manualmente:

```bash
docker compose up -d --build web
```

Acesse `http://localhost:3001`. Para descobrir o link de acesso externo (IP público muda conforme a operadora), rode `scripts/ip-externa.ps1`. Login padrão: `admin@admin / 123456`.
