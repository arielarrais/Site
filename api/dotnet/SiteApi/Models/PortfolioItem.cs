namespace SiteApi.Models;

public class PortfolioItem
{
    public int Id { get; set; }
    public int Userid { get; set; }
    public string Ticker { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public double Purchaseprice { get; set; }
    public string? Purchasedat { get; set; }
    public string? Institution { get; set; } = "";
    public string? Movement_type { get; set; } = "compra";
}
