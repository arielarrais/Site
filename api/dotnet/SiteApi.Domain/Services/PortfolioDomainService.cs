using SiteApi.Domain.Entities;
using SiteApi.Domain.Enums;

namespace SiteApi.Domain.Services;

public static class PortfolioDomainService
{
    public static int CalculateTotalQuantity(List<PortfolioItem> items, string ticker)
    {
        return items
            .Where(i => i.Ticker == ticker)
            .Sum(i => i.MovementType == MovementType.venda ? -i.Quantity : i.Quantity);
    }

    public static double CalculateAveragePrice(List<PortfolioItem> items, string ticker)
    {
        var relevant = items
            .Where(i => i.Ticker == ticker && i.MovementType == MovementType.compra && i.PurchasePrice > 0)
            .ToList();

        if (!relevant.Any()) return 0;

        var totalCost = relevant.Sum(i => i.Quantity * i.PurchasePrice);
        var totalQty = relevant.Sum(i => i.Quantity);

        return totalQty > 0 ? Math.Round(totalCost / totalQty, 2) : 0;
    }

    public static bool ShouldAutoCreateAsset(int quantity, double price)
    {
        return quantity > 0 && price > 0;
    }
}
