using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Interfaces.Repositories;
using SiteApi.Domain.Interfaces.Services;
using SiteApi.Infrastructure.Data;
using SiteApi.Infrastructure.Data.Repositories;
using SiteApi.Infrastructure.Services;

namespace SiteApi.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // Database
        services.AddDbContext<AppDbContext>(options =>
            options.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));

        // HTTP
        services.AddHttpClient();

        // Repositories
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IPortfolioRepository, PortfolioRepository>();
        services.AddScoped<IAssetRepository, AssetRepository>();
        services.AddScoped<IDividendRepository, DividendRepository>();
        services.AddScoped<IAuditLogRepository, AuditLogRepository>();

        // Infrastructure Services
        services.AddScoped<IQuoteService, BrapiQuoteService>();
        services.AddScoped<IGoogleSheetsService, GoogleSheetsService>();
        services.AddScoped<IXlsxParserService, XlsxParserService>();

        // Application Services
        services.AddScoped<IAuthService, AuthService>();

        return services;
    }
}
