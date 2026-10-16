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
| `DUCKDNS_DOMAIN` / `DUCKDNS_TOKEN` | Endereço público fixo (DDNS) |
| `ConnectionStrings__DefaultConnection` | Só para `dotnet run` fora do Docker |

A aplicação falha na inicialização se o `JWT_SECRET` estiver ausente ou curto demais.

## Como rodar

```bash
deploy.bat            # Windows: build + restart
```

ou manualmente:

```bash
docker compose up -d --build web proxy
```

Acesse `http://localhost:3001`. Para descobrir o link de acesso externo (IP público muda conforme a operadora), rode `scripts/ip-externa.ps1`. O usuário admin é `admin@admin`; a senha é pessoal e vive apenas no banco.

## Endereço fixo na internet (DDNS)

O link com IP público (`http://SEU-IP:3001`) quebra toda vez que a operadora troca o endereço da sua conexão. O DuckDNS resolve: ele aponta um nome fixo (ex.: `http://carteira.duckdns.org:3001`) para o seu IP atual, e um script atualiza o ponteiro sozinho.

1. Crie a conta em [duckdns.org](https://www.duckdns.org) e escolha um subdominio (ex.: `carteira`).
2. Preencha no `.env`:

```
DUCKDNS_DOMAIN=carteira
DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

3. Teste e agende a atualização automática:

```bash
powershell -NoProfile -File scripts/instalar-tarefa-ddns.ps1
```

Isso cria a tarefa agendada `Site-Atualizar-DDNS`, que roda `scripts/atualizar-ddns.ps1` a cada 5 minutos enquanto o Windows estiver ligado. Para desinstalar: `-Remover`.

Requisitos: a porta **3001** precisa continuar redirecionada no roteador para `192.168.15.5:3001` (TCP). O redirecionamento de portas não precisa ser refeito a cada troca de IP.

| Script | Para quê |
|---|---|
| `scripts/atualizar-ddns.ps1` | Aponta o DuckDNS para o IP público atual |
| `scripts/instalar-tarefa-ddns.ps1` | Instala a tarefa agendada que mantém o DDNS atualizado |
| `scripts/ip-externa.ps1` | Mostra o link local, o IP público e o link fixo do DDNS |

## HTTPS (certificado grátis)

O serviço `proxy` (Caddy) fica na frente da aplicação e serve `https://sitewallet.duckdns.org` com certificado do Let's Encrypt, renovado sozinho. O `Caddyfile` na raiz define o comportamento e o `docker-compose.yml` publica as portas 80 e 443.

Para funcionar, o roteador precisa liberar a **443** (TCP) para `192.168.15.5:443`. O certificado sai pelo desafio TLS-ALPN, que roda nessa própria porta; a 80 é opcional e serve só para redirecionar quem digita `http://`.

Sem a 443 liberada o Caddy fica tentando emitir o certificado sozinho (`docker logs site-proxy-1`) e o site continua acessível em `http://sitewallet.duckdns.org:3001`.

## Segurança

Como o site fica exposto na internet, a proteção está em três camadas:

| Camada | Onde | O que faz |
|---|---|---|
| Senha do Caddy | `Caddyfile` + `SITE_BASIC_AUTH_*` no `.env` | Pede usuário e senha **antes** de qualquer requisição chegar na aplicação |
| JWT | `Program.cs` + `SecureApiController` | `AdminController` exige a política `admin`; carteira e dividendos exigem login |
| Rate limit | política `auth` | Login e registro aceitam 10 tentativas a cada 5 minutos por IP |

Detalhes que importam:

- **A identidade vem do token, não do navegador.** As rotas de carteira e dividendos ignoram o `userId` enviado pelo cliente e usam o `id` do JWT, então um usuário logado não consegue ler nem apagar a carteira de outro.
- **`POST /api/register` é fechado por padrão.** Com `ALLOW_SELF_REGISTRATION=false` só o admin logado cria usuário. Para reativar o "cadastrar-se" da tela de login, ponha `true` no `.env` e rode `deploy.bat`.
- **Senha mínima de 8 caracteres** no registro e na troca de senha.
- **Troca de senha:** `POST /api/auth/change-password` com `currentPassword` e `newPassword`, usando o token do usuário.
- **A porta 3001 é uma porta alternativa.** Ela contorna a senha do Caddy, porque o acesso direto vai direto para a aplicação. Depois que o HTTPS estiver funcionando, vale fechar a 3001 no roteador (ou trocar por `127.0.0.1:3001:3001` no `docker-compose.yml`) para que a senha do Caddy seja mesmo a única porta de entrada.

Os valores `SITE_BASIC_AUTH_USER` e `SITE_BASIC_AUTH_HASH` ficam no `.env` (fora do git). O hash é bcrypt com o `$` escapado como `$$`, porque o Caddy lê `$` como variável de ambiente. Para trocar a senha do Caddy:

```bash
docker compose exec proxy caddy hash-password --plaintext "nova-senha"
```

e atualize `SITE_BASIC_AUTH_HASH` no `.env` com o valor devolvido (mantendo o `$$`).
