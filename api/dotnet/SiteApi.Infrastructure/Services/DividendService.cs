using SiteApi.Application.DTOs.Dividends;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Enums;
using SiteApi.Domain.Interfaces.Repositories;

namespace SiteApi.Infrastructure.Services;

public class DividendService : IDividendService
{
    private readonly IDividendRepository _dividendRepo;
    private readonly IAssetRepository _assetRepo;
    private readonly IPortfolioRepository _portfolioRepo;

    public DividendService(IDividendRepository dividendRepo, IAssetRepository assetRepo, IPortfolioRepository portfolioRepo)
    {
        _dividendRepo = dividendRepo;
        _assetRepo = assetRepo;
        _portfolioRepo = portfolioRepo;
    }

    public async Task<List<DividendDto>> GetByTickerAsync(string ticker)
    {
        var dividends = await _dividendRepo.GetByTickerAsync(ticker.Trim().ToUpper());
        return dividends.Select(MapToDto).ToList();
    }

    public async Task<List<DividendDto>> GetByAssetIdAsync(int assetId)
    {
        var dividends = await _dividendRepo.GetByAssetIdAsync(assetId);
        return dividends.Select(MapToDto).ToList();
    }

    public async Task<List<DividendDto>> GetByUserIdAsync(int userId)
    {
        var dividends = await _dividendRepo.GetByUserIdAsync(userId);
        return dividends.Select(MapToDto).ToList();
    }

    public async Task<List<MonthlyDividendDto>> GetMonthlyAsync(int userId)
    {
        var portfolioItems = await _portfolioRepo.GetByUserIdAsync(userId);
        var dividends = await _dividendRepo.GetByUserIdAsync(userId);

        var assets = await _assetRepo.GetAllAsync();
        var tickerMap = assets.ToDictionary(a => a.Id, a => a.Ticker);

        var grouped = dividends
            .Where(d => !string.IsNullOrEmpty(d.PaymentDate) && d.GrossAmount.HasValue && !string.IsNullOrEmpty(d.ComDate))
            .GroupBy(d =>
            {
                var date = DateTime.TryParse(d.PaymentDate, out var dt) ? dt : DateTime.MinValue;
                var ticker = tickerMap.TryGetValue(d.AssetId, out var t) ? t : "?";
                return $"{ticker}_{date:yyyy-MM}";
            })
            .Select(g =>
            {
                var ticker = tickerMap.TryGetValue(g.First().AssetId, out var t) ? t : "?";
                var date = DateTime.TryParse(g.First().PaymentDate, out var dt) ? dt : DateTime.MinValue;
                var held = HeldQuantityAt(portfolioItems, ticker, g.First().ComDate!);
                var total = held > 0
                    ? Math.Round(g.Sum(d => (d.GrossAmount ?? 0) * held), 2)
                    : 0d;
                return new MonthlyDividendDto(ticker, date.ToString("yyyy-MM"), total, g.Count());
            })
            .Where(m => m.Total > 0)
            .OrderBy(m => m.Month)
            .ThenBy(m => m.Ticker)
            .ToList();

        return grouped;
    }

    public async Task<DividendCalendarDto> GetCalendarAsync(int userId, int year)
    {
        var portfolioItems = await _portfolioRepo.GetByUserIdAsync(userId);
        var dividends = await _dividendRepo.GetByUserIdAsync(userId);

        var assets = await _assetRepo.GetAllAsync();
        var assetByTicker = assets
            .GroupBy(a => a.Ticker, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key.ToUpperInvariant(), g => g.First());
        var tickerByAssetId = assets.ToDictionary(a => a.Id, a => a.Ticker);

        var entries = dividends
            .Where(d => d.GrossAmount is > 0 && !string.IsNullOrEmpty(d.PaymentDate))
            .Select(d => new CalendarEntry(
                tickerByAssetId.TryGetValue(d.AssetId, out var ticker) ? ticker : "?",
                ParseDate(d.PaymentDate),
                (d.GrossAmount ?? 0d),
                d.ComDate))
            .Where(e => e.Month != 0)
            .ToList();

        var availableYears = entries
            .Where(e => e.Date.Year is >= 1990 and <= 2100)
            .Select(e => e.Date.Year)
            .Distinct()
            .OrderByDescending(y => y)
            .ToList();
        if (!availableYears.Contains(DateTime.Now.Year))
            availableYears.Insert(0, DateTime.Now.Year);

        var tickers = portfolioItems
            .Select(i => i.Ticker)
            .Where(t => !string.IsNullOrEmpty(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(t => t.ToUpperInvariant())
            .OrderByDescending(t => assetByTicker.TryGetValue(t, out var a) && a.IsFii())
            .ThenBy(t => t, StringComparer.Ordinal)
            .ToList();

        var rows = tickers.Select(ticker =>
        {
            var byMonth = entries
                .Where(e => string.Equals(e.Ticker, ticker, StringComparison.OrdinalIgnoreCase) && e.Date.Year == year)
                .GroupBy(e => e.Date.Month)
                .ToDictionary(g => g.Key, g => g.ToList());

            var months = Enumerable.Range(1, 12).Select(month =>
            {
                if (!byMonth.TryGetValue(month, out var items))
                    return new DividendCalendarMonthDto(month, 0d, 0d, 0);

                var perShare = Math.Round(items.Sum(i => i.PerShare), 4);
                var total = Math.Round(items.Sum(i =>
                {
                    var held = HeldQuantityAt(portfolioItems, ticker, i.ComDate);
                    return held > 0 ? held * i.PerShare : 0d;
                }), 2);

                return new DividendCalendarMonthDto(month, perShare, total, items.Count);
            }).ToList();

            assetByTicker.TryGetValue(ticker, out var asset);
            return new DividendCalendarRowDto(
                ticker,
                asset?.Name,
                asset?.AssetType,
                asset?.IsFii() ?? ticker.EndsWith("11", StringComparison.Ordinal),
                months,
                Math.Round(months.Sum(m => m.PerShare), 4),
                Math.Round(months.Sum(m => m.Total), 2));
        }).ToList();

        return new DividendCalendarDto(year, availableYears, rows);
    }

    public async Task<DividendDto> CreateAsync(CreateDividendRequest request)
    {
        if (request.AssetId <= 0) throw new ArgumentException("assetId é obrigatório.");
        if (string.IsNullOrEmpty(request.PaymentDate)) throw new ArgumentException("paymentDate é obrigatório.");
        if (request.GrossAmount <= 0) throw new ArgumentException("grossAmount deve ser maior que 0.");

        var dividend = new AssetDividend
        {
            AssetId = request.AssetId,
            PaymentDate = request.PaymentDate,
            GrossAmount = request.GrossAmount,
            NetAmount = request.NetAmount,
            Description = request.Description,
            Type = request.Type ?? "dividendo"
        };

        await _dividendRepo.AddAsync(dividend);
        return MapToDto(dividend);
    }

    private static DividendDto MapToDto(AssetDividend d) =>
        new(d.Id, d.AssetId, null, d.ComDate, d.PaymentDate, d.GrossAmount,
            d.NetAmount, d.Description, d.Type, d.CreatedAt);

    private sealed record CalendarEntry(string Ticker, DateTime Date, double PerShare, string? ComDate)
    {
        public int Month => Date.Month;
    }

    private static DateTime ParseDate(string? value) =>
        DateTime.TryParse(value, out var dt) ? dt : DateTime.MinValue;

    private static double HeldQuantityAt(List<PortfolioItem> items, string ticker, string? asOfDate) =>
        string.IsNullOrEmpty(asOfDate)
            ? 0d
            : items
                .Where(i => string.Equals(i.Ticker, ticker, StringComparison.OrdinalIgnoreCase)
                            && !string.IsNullOrEmpty(i.PurchaseDate)
                            && string.Compare(i.PurchaseDate, asOfDate) <= 0)
                .Sum(i => i.MovementType == MovementType.venda ? -i.Quantity : (double)i.Quantity);
}
