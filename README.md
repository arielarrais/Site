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
| **Node.js** | Runtime rápido e familiar para APIs REST |
| **Express** | Framework minimalista e maduro para roteamento HTTP |
| **PostgreSQL** | Banco relacional robusto, utilizado em produção via Railway |
| **Vanilla JS** | Sem dependência de framework — projeto pequeno, sem necessidade de React/Vue |
| **Brapi.dev** | API gratuita e completa com dados de ações e FIIs brasileiros |

## Pré-requisitos

- **Node.js 18+**
- **PostgreSQL 15+** rodando localmente

## Configuração do banco

Crie o banco de dados:

```bash
psql -U postgres -c "CREATE DATABASE site_db;"
```

Copie o arquivo `.env.example` para `.env` e ajuste se necessário:

```env
DATABASE_URL=postgresql://postgres:admin@localhost:5432/site_db
BRAPI_TOKEN=seu_token_aqui
```

## Migração dos dados (SQLite → PostgreSQL)

Se já utilizava o projeto com SQLite, migre os dados:

```bash
node _migrate.js
```

## Como rodar

```bash
npm install
node server.js
```

Acesse `http://localhost:3001`. Login padrão: `admin / 123456`.
