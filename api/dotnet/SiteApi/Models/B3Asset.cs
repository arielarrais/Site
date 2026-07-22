namespace SiteApi.Models;

public class B3Asset
{
    public int Id { get; set; }
    public string Ticker { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? Assettype { get; set; }
    public string? Createdat { get; set; }
    public string? Longname { get; set; }
    public string? Sector { get; set; }
    public string? Regularmarketprice { get; set; }
    public string? Logourl { get; set; }
    public string? Fiitype { get; set; }
}
