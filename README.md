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
| **SQLite** | Banco zero configuração, sem servidor externo, ideal para projetos individuais |
| **Vanilla JS** | Sem dependência de framework — projeto pequeno, sem necessidade de React/Vue |
| **Brapi.dev** | API gratuita e completa com dados de ações e FIIs brasileiros |

## Como rodar

```bash
npm install
node server.js
```

Acesse `http://localhost:3001`. Login padrão: `admin / 123456`.
