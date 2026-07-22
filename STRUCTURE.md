Site/
├── .gitignore
├── README.md
├── database.sqlite
│
├── client/                          # Frontend
│   ├── login.html
│   ├── dashboard.html
│   ├── lancamentos.html
│   ├── dividendos.html
│   ├── ativos.html
│   ├── usuarios.html
│   ├── configuracoes.html
│   └── public/
│       ├── styles.css
│       ├── script.js
│       ├── admin.js
│       ├── lancamentos.js
│       ├── dividendos.js
│       ├── configuracoes.js
│       └── usuarios.js
│
├── api/
│   ├── node/                        # Backend Node.js (original)
│   │   ├── server.js                # Express server (1826 linhas)
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   ├── .env                     # Variáveis de ambiente
│   │   ├── .env.example
│   │   ├── fetch_dividendos.js      # Módulo de sync de dividendos
│   │   ├── nginx.conf               # Config nginx (deploy)
│   │   ├── render.yaml              # Config Render.com
│   │   ├── _migrate.js              # Migração SQLite -> PostgreSQL
│   │   ├── _migrar_prod.js          # Migração produção
│   │   ├── _fix_pgto.js             # Correção datas pagamento
│   │   ├── _check.js                # Diagnóstico
│   │   ├── gerar_acoes.js           # Gerador tickers ações
│   │   ├── gerar_fiis.js            # Gerador tickers FIIs
│   │   ├── classificar_fiis.js      # Classificador FIIs
│   │   └── Tickers/
│   │       ├── acoes_b3.csv
│   │       ├── acoes_b3.xlsx
│   │       ├── fiis_b3.csv
│   │       └── fiis_b3.xlsx
│   │
│   └── dotnet/SiteApi/              # Backend .NET 11 (novo)
│       ├── SiteApi.csproj           # Projeto .NET 11
│       ├── Program.cs               # Startup: JWT, PostgreSQL, CORS, static files
│       ├── appsettings.json         # Configurações (DB, JWT, Brapi, Google)
│       ├── appsettings.Development.json
│       │
│       ├── Controllers/
│       │   ├── AuthController.cs           # /api/register, /api/login, /api/auth/validate
│       │   ├── PortfolioController.cs      # /api/portfolio (CRUD + XLSX parse)
│       │   ├── AssetsController.cs         # /api/b3-assets, /api/assets/*
│       │   ├── DividendsController.cs      # /api/dividends, /api/dividends/monthly
│       │   ├── QuotesController.cs         # /api/quote, /api/quotes, /api/quotes/sheets
│       │   ├── AdminController.cs          # /api/admin/*
│       │   └── PagesController.cs          # /, /dashboard, /lancamentos, etc
│       │
│       ├── Models/
│       │   ├── User.cs
│       │   ├── PortfolioItem.cs
│       │   ├── B3Asset.cs
│       │   ├── AssetDividend.cs
│       │   ├── AuditLog.cs
│       │   └── Dtos.cs               # Request/Response DTOs
│       │
│       ├── Data/
│       │   └── AppDbContext.cs        # Entity Framework Core context
│       │
│       └── Properties/
│           └── launchSettings.json
│
├── node_modules/                    # (gitignored)
└── .git/
