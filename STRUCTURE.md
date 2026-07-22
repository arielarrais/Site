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
│   │   ├── server.js
│   │   ├── package.json
│   │   ├── .env
│   │   ├── fetch_dividendos.js
│   │   └── Tickers/
│   │
│   └── dotnet/                      # Backend .NET 11 (DDD Architecture)
│       ├── SiteApi.sln              # Solution file
│       │
│       ├── SiteApi.Domain/          # Domain Layer (no dependencies)
│       │   ├── Entities/
│       │   │   ├── User.cs
│       │   │   ├── PortfolioItem.cs     # + domain logic (IsSale, EffectiveQuantity)
│       │   │   ├── B3Asset.cs           # + domain logic (IsFii)
│       │   │   ├── AssetDividend.cs     # + domain logic (HasValidDates)
│       │   │   └── AuditLog.cs
│       │   ├── Enums/
│       │   │   ├── MovementType.cs
│       │   │   ├── AssetType.cs
│       │   │   └── DividendType.cs
│       │   ├── Interfaces/
│       │   │   ├── Repositories/        # Repository contracts
│       │   │   │   ├── IUserRepository.cs
│       │   │   │   ├── IPortfolioRepository.cs
│       │   │   │   ├── IAssetRepository.cs
│       │   │   │   ├── IDividendRepository.cs
│       │   │   │   └── IAuditLogRepository.cs
│       │   │   └── Services/            # External service contracts
│       │   │       ├── IQuoteService.cs
│       │   │       ├── IDividendFetchingService.cs
│       │   │       ├── IGoogleSheetsService.cs
│       │   │       └── IXlsxParserService.cs
│       │   ├── Services/
│       │   │   └── PortfolioDomainService.cs  # Domain logic
│       │   └── Exceptions/
│       │       ├── DomainException.cs
│       │       └── EntityNotFoundException.cs
│       │
│       ├── SiteApi.Application/     # Application Layer (use cases)
│       │   ├── DTOs/
│       │   │   ├── Auth/             # LoginRequest, RegisterRequest, LoginResponse
│       │   │   ├── Portfolio/        # PortfolioItemDto, Create/Update requests
│       │   │   ├── Assets/           # AssetDto, AssetTypeDto
│       │   │   ├── Dividends/        # DividendDto, MonthlyDividendDto, requests
│       │   │   └── Quotes/           # QuoteDto
│       │   ├── Interfaces/
│       │   │   ├── IAuthService.cs
│       │   │   ├── IPortfolioService.cs
│       │   │   ├── IAssetService.cs
│       │   │   ├── IDividendService.cs
│       │   │   ├── IQuoteAppService.cs
│       │   │   └── IAdminService.cs
│       │   └── Services/
│       │       └── AuthService.cs    # Moved to Infrastructure
│       │
│       ├── SiteApi.Infrastructure/  # Infrastructure Layer (implementations)
│       │   ├── Data/
│       │   │   ├── AppDbContext.cs   # EF Core DbContext
│       │   │   └── Repositories/     # Repository implementations
│       │   │       ├── UserRepository.cs
│       │   │       ├── PortfolioRepository.cs
│       │   │       ├── AssetRepository.cs
│       │   │       ├── DividendRepository.cs
│       │   │       └── AuditLogRepository.cs
│       │   ├── Services/             # External service implementations
│       │   │   ├── AuthService.cs    # JWT + BCrypt
│       │   │   ├── BrapiQuoteService.cs
│       │   │   ├── YahooQuoteService.cs
│       │   │   ├── GoogleSheetsService.cs
│       │   │   └── XlsxParserService.cs
│       │   └── DependencyInjection.cs  # DI extension method
│       │
│       └── SiteApi/                 # Presentation Layer (API)
│           ├── Program.cs           # Startup, auth, CORS, static files
│           ├── appsettings.json
│           ├── SiteApi.csproj       # References Domain, Application, Infrastructure
│           └── Controllers/
│               ├── AuthController.cs
│               ├── PortfolioController.cs
│               ├── AssetsController.cs
│               ├── DividendsController.cs
│               ├── QuotesController.cs
│               ├── AdminController.cs
│               └── PagesController.cs
│
├── node_modules/                    # (gitignored)
└── .git/
