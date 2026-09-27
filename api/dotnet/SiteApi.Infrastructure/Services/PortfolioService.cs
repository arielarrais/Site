using SiteApi.Application.DTOs.Portfolio;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Enums;
using SiteApi.Domain.Interfaces.Repositories;
using SiteApi.Domain.Services;

namespace SiteApi.Infrastructure.Services;

public class PortfolioService : IPortfolioService
{
    private readonly IPortfolioRepository _portfolioRepo;
    private readonly IAssetRepository _assetRepo;
    private readonly IDividendRepository _dividendRepo;

    public PortfolioService(IPortfolioRepository portfolioRepo, IAssetRepository assetRepo, IDividendRepository dividendRepo)
    {
        _portfolioRepo = portfolioRepo;
        _assetRepo = assetRepo;
        _dividendRepo = dividendRepo;
    }

    public async Task<List<PortfolioItemDto>> GetByUserIdAsync(int userId)
    {
        var items = await _portfolioRepo.GetByUserIdAsync(userId);
        return items.Select(MapToDto).ToList();
    }

    public async Task<PortfolioItemDto> AddAsync(CreatePortfolioItemRequest request)
    {
        if (request.UserId <= 0) throw new ArgumentException("userId é obrigatório.");
        if (string.IsNullOrWhiteSpace(request.Ticker)) throw new ArgumentException("Ticker é obrigatório.");
        if (request.Quantity <= 0) throw new ArgumentException("Quantidade deve ser maior que 0.");

        var ticker = request.Ticker.Trim().ToUpper();
        var movement = Enum.TryParse<MovementType>(request.MovementType, true, out var m) ? m : MovementType.compra;

        var item = new PortfolioItem
        {
            UserId = request.UserId,
            Ticker = ticker,
            Quantity = Math.Abs(request.Quantity),
            PurchasePrice = request.PurchasePrice,
            PurchaseDate = NormalizeDate(request.PurchaseDate),
            Institution = request.Institution ?? "",
            MovementType = movement
        };

        await _portfolioRepo.AddAsync(item);

        if (PortfolioDomainService.ShouldAutoCreateAsset(request.Quantity, request.PurchasePrice))
        {
            var existing = await _assetRepo.GetByTickerAsync(ticker);
            if (existing == null)
            {
                var name = await TryFetchNameAsync(ticker);
                await _assetRepo.AddAsync(new B3Asset { Ticker = ticker, Name = name ?? ticker });
            }
        }

        return MapToDto(item);
    }

    public async Task<PortfolioItemDto> UpdateAsync(UpdatePortfolioItemRequest request)
    {
        if (request.UserId <= 0) throw new ArgumentException("userId é obrigatório.");
        if (request.Id <= 0) throw new ArgumentException("id é obrigatório.");

        var item = await _portfolioRepo.GetByIdAsync(request.Id)
            ?? throw new ArgumentException("Item não encontrado.");

        if (item.UserId != request.UserId)
            throw new ArgumentException("Item não pertence ao usuário.");

        if (request.Quantity.HasValue) item.Quantity = Math.Abs(request.Quantity.Value);
        if (request.PurchasePrice.HasValue) item.PurchasePrice = request.PurchasePrice.Value;
        if (request.PurchaseDate != null) item.PurchaseDate = NormalizeDate(request.PurchaseDate);

        await _portfolioRepo.UpdateAsync(item);
        return MapToDto(item);
    }

    public async Task DeleteAsync(int userId, int id)
    {
        var item = await _portfolioRepo.GetByIdAsync(id)
            ?? throw new ArgumentException("Item não encontrado.");
        if (item.UserId != userId)
            throw new ArgumentException("Item não pertence ao usuário.");
        await _portfolioRepo.DeleteAsync(id);
    }

    public async Task ClearAsync(int userId)
    {
        await _portfolioRepo.DeleteByUserIdAsync(userId);
    }

    public async Task<List<object>> GetDividendReturnsAsync(int userId)
    {
        var items = await _portfolioRepo.GetByUserIdAsync(userId);
        var tickers = items.Select(i => i.Ticker).Distinct().ToList();

        var result = new List<object>();
        foreach (var ticker in tickers)
        {
            var tickerItems = items.Where(i => i.Ticker == ticker).ToList();
            var purchaseDate = tickerItems
                .Where(i => i.PurchaseDate != null)
                .MinBy(i => i.PurchaseDate)?.PurchaseDate;

            var tickerDividends = (await _dividendRepo.GetByTickerAsync(ticker))
                .Where(d => !string.IsNullOrEmpty(d.ComDate) && !string.IsNullOrEmpty(d.PaymentDate))
                .Where(d => purchaseDate == null || string.Compare(d.ComDate, purchaseDate) >= 0)
                .ToList();

            var totalDividends = tickerDividends
                .Sum(d => Math.Max(0, HeldQuantityAt(tickerItems, d.ComDate)) * (d.GrossAmount ?? 0));
            var asset = await _assetRepo.GetByTickerAsync(ticker);

            result.Add(new
            {
                ticker,
                name = asset?.Name ?? ticker,
                quantity = PortfolioDomainService.CalculateTotalQuantity(items, ticker),
                averagePrice = PortfolioDomainService.CalculateAveragePrice(items, ticker),
                totalDividends = Math.Round(totalDividends, 2),
                dividendCount = tickerDividends.Count,
                lastPaymentDate = tickerDividends.FirstOrDefault()?.PaymentDate
            });
        }

        return result;
    }

    private static double HeldQuantityAt(List<PortfolioItem> items, string asOfDate) =>
        items
            .Where(i => !string.IsNullOrEmpty(i.PurchaseDate) && string.Compare(i.PurchaseDate, asOfDate) <= 0)
            .Sum(i => i.MovementType == MovementType.venda ? -i.Quantity : (double)i.Quantity);

    private static PortfolioItemDto MapToDto(PortfolioItem item) =>
        new(item.Id, item.Ticker, item.Quantity, item.PurchasePrice,
            item.PurchaseDate, item.Institution, item.MovementType.ToString());

    private static string? NormalizeDate(string? date)
    {
        if (string.IsNullOrWhiteSpace(date)) return null;
        if (date.Contains('/'))
        {
            var parts = date.Split('/');
            if (parts.Length == 3) return $"{parts[2]}-{parts[1]}-{parts[0]}";
        }
        return date;
    }

    private async Task<string?> TryFetchNameAsync(string ticker)
    {
        try
        {
            var existing = await _assetRepo.GetByTickerAsync(ticker);
            return existing?.Name;
        }
        catch { return null; }
    }
}
