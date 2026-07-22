using SiteApi.Domain.Enums;

namespace SiteApi.Domain.Entities;

public class PortfolioItem
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Ticker { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public double PurchasePrice { get; set; }
    public string? PurchaseDate { get; set; }
    public string? Institution { get; set; } = "";
    public MovementType MovementType { get; set; } = MovementType.compra;

    // Domain logic
    public bool IsSale() => MovementType == MovementType.venda;
    public int EffectiveQuantity => IsSale() ? -Quantity : Quantity;
}
