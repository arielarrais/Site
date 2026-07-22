using System.Text.Json;
using Microsoft.Extensions.Configuration;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class BrapiQuoteService : IQuoteService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private const string YahooUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    private string BrapiToken => _config["BrapiToken"] ?? "";

    public BrapiQuoteService(IHttpClientFactory httpFactory, IConfiguration config)
    {
        _httpFactory = httpFactory;
        _config = config;
    }

    public async Task<QuoteResult?> GetQuoteAsync(string ticker)
    {
        try
        {
            var client = _httpFactory.CreateClient();
            var url = $"https://brapi.dev/api/quote/{Uri.EscapeDataString(ticker)}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime";
            if (!string.IsNullOrEmpty(BrapiToken)) url += $"&token={Uri.EscapeDataString(BrapiToken)}";

            var response = await client.GetAsync(url);
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            var quote = doc.RootElement.TryGetProperty("results", out var results) && results.GetArrayLength() > 0
                ? results[0] : default;

            if (quote.ValueKind != JsonValueKind.Undefined &&
                quote.TryGetProperty("regularMarketPrice", out var priceProp) && priceProp.ValueKind != JsonValueKind.Null)
            {
                var name = quote.TryGetProperty("shortName", out var sn) ? sn.GetString() ?? ticker : ticker;
                var cp = quote.TryGetProperty("changePercent", out var cpP) && cpP.ValueKind != JsonValueKind.Null ? cpP.GetDouble() : (double?)null;
                var tm = quote.TryGetProperty("regularMarketTime", out var tmP) && tmP.ValueKind != JsonValueKind.Null ? tmP.ToString() : null;
                return new QuoteResult(ticker, priceProp.GetDouble(), name, cp, tm);
            }

            return null;
        }
        catch { return null; }
    }

    public async Task<Dictionary<string, QuoteResult>> GetQuotesAsync(List<string> tickers)
    {
        var result = new Dictionary<string, QuoteResult>();
        try
        {
            var client = _httpFactory.CreateClient();
            var tickerParam = string.Join(",", tickers.Select(Uri.EscapeDataString));
            var url = $"https://brapi.dev/api/quote/{tickerParam}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime";
            if (!string.IsNullOrEmpty(BrapiToken)) url += $"&token={Uri.EscapeDataString(BrapiToken)}";

            var response = await client.GetAsync(url);
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            var quotes = doc.RootElement.TryGetProperty("results", out var results)
                ? results.EnumerateArray().ToList() : new();

            foreach (var q in quotes)
            {
                if (q.TryGetProperty("symbol", out var symProp))
                {
                    var sym = symProp.GetString()?.ToUpper() ?? "";
                    var price = q.TryGetProperty("regularMarketPrice", out var p) && p.ValueKind != JsonValueKind.Null ? p.GetDouble() : 0;
                    var name = q.TryGetProperty("shortName", out var sn) ? sn.GetString() ?? sym : sym;
                    var cp = q.TryGetProperty("changePercent", out var cpP) && cpP.ValueKind != JsonValueKind.Null ? cpP.GetDouble() : (double?)null;
                    var tm = q.TryGetProperty("regularMarketTime", out var tmP) && tmP.ValueKind != JsonValueKind.Null ? tmP.ToString() : null;
                    result[sym] = new QuoteResult(sym, price, name, cp, tm);
                }
            }
        }
        catch { }
        return result;
    }
}
