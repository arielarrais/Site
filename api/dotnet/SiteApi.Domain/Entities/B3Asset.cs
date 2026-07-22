namespace SiteApi.Domain.Entities;

public class B3Asset
{
    public int Id { get; set; }
    public string Ticker { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? AssetType { get; set; }
    public string? CreatedAt { get; set; }
    public string? LongName { get; set; }
    public string? Sector { get; set; }
    public string? RegularMarketPrice { get; set; }
    public string? LogoUrl { get; set; }
    public string? FiiType { get; set; }

    public bool IsFii() => AssetType == "fii" || Ticker.EndsWith("11");
}
