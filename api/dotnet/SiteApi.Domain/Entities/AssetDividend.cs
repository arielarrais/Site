namespace SiteApi.Domain.Entities;

public class AssetDividend
{
    public int Id { get; set; }
    public int AssetId { get; set; }
    public string? PaymentDate { get; set; }
    public double? GrossAmount { get; set; }
    public double? NetAmount { get; set; }
    public string? Description { get; set; }
    public string? CreatedAt { get; set; }
    public string? ComDate { get; set; }
    public string? Type { get; set; } = "dividendo";

    public bool HasValidDates() => !string.IsNullOrEmpty(ComDate) && !string.IsNullOrEmpty(PaymentDate);
}
