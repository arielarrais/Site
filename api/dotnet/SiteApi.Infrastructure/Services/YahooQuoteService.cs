using System.Text.Json;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class YahooQuoteService : IQuoteService
{
    private readonly IHttpClientFactory _httpFactory;
    private const string YahooUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

    public YahooQuoteService(IHttpClientFactory httpFactory)
    {
        _httpFactory = httpFactory;
    }

    public async Task<QuoteResult?> GetQuoteAsync(string ticker)
    {
        try
        {
            var yahooTicker = ticker.Contains('.') ? ticker : $"{ticker}.SA";
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Add("User-Agent", YahooUA);
            var response = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?interval=1d&range=1d");
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            var meta = doc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");

            if (!meta.TryGetProperty("regularMarketPrice", out var priceProp) || priceProp.ValueKind == JsonValueKind.Null)
                return null;

            var name = meta.TryGetProperty("symbol", out var s) ? s.GetString() : ticker;
            return new QuoteResult(ticker, priceProp.GetDouble(), name, null, null);
        }
        catch { return null; }
    }

    public async Task<Dictionary<string, QuoteResult>> GetQuotesAsync(List<string> tickers)
    {
        var result = new Dictionary<string, QuoteResult>();
        var tasks = tickers.Select(async t =>
        {
            var quote = await GetQuoteAsync(t);
            return (ticker: t, quote);
        });

        var results = await Task.WhenAll(tasks);
        foreach (var r in results)
        {
            if (r.quote != null)
                result[r.ticker] = r.quote;
        }
        return result;
    }
}
