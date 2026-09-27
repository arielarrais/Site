using SiteApi.Application.DTOs.Dividends;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class AdminService : IAdminService
{
    private readonly IAssetRepository _assetRepo;
    private readonly IDividendRepository _dividendRepo;
    private readonly IUserRepository _userRepo;
    private readonly IDividendFetchingService _dividendFetchingService;

    public AdminService(
        IAssetRepository assetRepo,
        IDividendRepository dividendRepo,
        IUserRepository userRepo,
        IDividendFetchingService dividendFetchingService)
    {
        _assetRepo = assetRepo;
        _dividendRepo = dividendRepo;
        _userRepo = userRepo;
        _dividendFetchingService = dividendFetchingService;
    }

    public async Task<List<object>> GetAssetsAsync()
    {
        var assets = await _assetRepo.GetAllAsync();
        var result = new List<object>();

        foreach (var a in assets)
        {
            var dividends = await _dividendRepo.GetByAssetIdAsync(a.Id);
            var last = dividends.FirstOrDefault();
            result.Add(new
            {
                id = a.Id,
                ticker = a.Ticker,
                name = a.Name,
                assettype = a.AssetType,
                fiitype = a.FiiType,
                lastcomdate = last?.ComDate,
                lastdividenddate = last?.PaymentDate,
                lastdividendvalue = last?.GrossAmount
            });
        }

        return result.OrderBy(a => ((dynamic)a).assettype).ThenBy(a => ((dynamic)a).ticker).ToList();
    }

    public async Task<List<object>> GetDividendsAsync(int? assetId)
    {
        var dividends = assetId.HasValue
            ? await _dividendRepo.GetByAssetIdAsync(assetId.Value)
            : await _dividendRepo.GetAllAsync();

        return dividends.Select(d => (object)new
        {
            id = d.Id,
            assetid = d.AssetId,
            paymentdate = d.PaymentDate,
            grossamount = d.GrossAmount,
            netamount = d.NetAmount,
            description = d.Description,
            type = d.Type,
            createdat = d.CreatedAt
        }).ToList();
    }

    public async Task<DividendDto> CreateDividendAsync(AdminDividendRequest request)
    {
        if (request.AssetId <= 0 || string.IsNullOrEmpty(request.ComDate) ||
            string.IsNullOrEmpty(request.PaymentDate) || request.GrossAmount <= 0)
            throw new ArgumentException("assetId, comDate, paymentDate e grossAmount são obrigatórios.");

        var dividend = new AssetDividend
        {
            AssetId = request.AssetId,
            ComDate = request.ComDate,
            PaymentDate = request.PaymentDate,
            GrossAmount = request.GrossAmount,
            Type = request.Type ?? "dividendo"
        };

        await _dividendRepo.AddAsync(dividend);

        return new DividendDto(dividend.Id, dividend.AssetId, null, dividend.ComDate,
            dividend.PaymentDate, dividend.GrossAmount, null, null, dividend.Type, dividend.CreatedAt);
    }

    public async Task<Dictionary<string, object>> SyncBrapiAsync(string ticker)
    {
        ticker = ticker.Trim().ToUpper();
        var asset = await _assetRepo.GetByTickerAsync(ticker);
        if (asset == null)
            throw new ArgumentException($"Ativo {ticker} não encontrado.");

        return new Dictionary<string, object>
        {
            ["ticker"] = ticker,
            ["name"] = asset.Name ?? ticker,
            ["assettype"] = asset.AssetType ?? "other"
        };
    }

    public async Task<object> FetchDividendsAsync(string ticker)
    {
        ticker = ticker.Trim().ToUpper();
        var asset = await _assetRepo.GetByTickerAsync(ticker);
        if (asset == null) throw new ArgumentException($"Ativo {ticker} não encontrado.");

        var result = await _dividendFetchingService.FetchAndSyncAssetDividendsAsync(asset.Id, ticker);
        return new { ticker, source = result.Source, inserted = result.Inserted, updated = result.Updated, skipped = result.Skipped, total = result.Total };
    }

    public async Task<object> FetchAllDividendsAsync()
    {
        var assets = await _assetRepo.GetAllAsync();
        _ = Task.Run(async () =>
        {
            foreach (var a in assets)
            {
                try { await _dividendFetchingService.FetchAndSyncAssetDividendsAsync(a.Id, a.Ticker); }
                catch { }
            }
        });
        return new { total = assets.Count, message = "Sincronização iniciada em segundo plano." };
    }

    public Task<object> SyncDividendsAsync()
    {
        return Task.FromResult<object>(new { message = "Sync dividends not implemented yet." });
    }

    public Task<object> FixPaymentDatesAsync()
    {
        return Task.FromResult<object>(new { message = "Fix payment dates not implemented yet." });
    }

    public Task<object> SyncTickersSheetAsync()
    {
        return Task.FromResult<object>(new { message = "Sync tickers sheet not implemented yet." });
    }

    public async Task<List<object>> GetUsersAsync()
    {
        var users = await _userRepo.GetAllAsync();
        return users.Select(u => (object)new
        {
            id = u.Id,
            username = u.Username,
            fullname = u.Fullname,
            email = u.Email
        }).ToList();
    }
}
