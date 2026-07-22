namespace SiteApi.Models;

public class AssetDividend
{
    public int Id { get; set; }
    public int Assetid { get; set; }
    public string? Paymentdate { get; set; }
    public double? Grossamount { get; set; }
    public double? Netamount { get; set; }
    public string? Description { get; set; }
    public string? Createdat { get; set; }
    public string? Comdate { get; set; }
    public string? Type { get; set; } = "dividendo";
}
