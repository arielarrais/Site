using System.Globalization;
using System.Text.RegularExpressions;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class DividendFetchingService : IDividendFetchingService
{
    private readonly IAssetRepository _assetRepo;
    private readonly IDividendRepository _dividendRepo;
    private readonly IHttpClientFactory _httpFactory;
    private const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    public DividendFetchingService(
        IAssetRepository assetRepo,
        IDividendRepository dividendRepo,
        IHttpClientFactory httpFactory)
    {
        _assetRepo = assetRepo;
        _dividendRepo = dividendRepo;
        _httpFactory = httpFactory;
    }

    private sealed record FetchedDividend(string ComDate, string? PaymentDate, double GrossAmount, string Type);

    public async Task<FetchResult> FetchAndSyncAssetDividendsAsync(int assetId, string ticker)
    {
        var asset = await _assetRepo.GetByIdAsync(assetId);
        if (asset == null)
            return new FetchResult("error", 0, 0, 0, 0);

        var isFii = asset.IsFii();
        var dividends = new List<FetchedDividend>();
        var source = "";

        try
        {
            if (isFii)
            {
                dividends = await FetchInvistaInfoAsync(ticker);
                if (dividends.Count > 0) source = "InvistaInfo";
                else if ((dividends = await FetchFundamentusAsync(ticker, isFii: true)).Count > 0) source = "Fundamentus";
                else if ((dividends = await FetchStockAnalysisAsync(ticker)).Count > 0) source = "StockAnalysis";
            }
            else
            {
                if ((dividends = await FetchFundamentusAsync(ticker, isFii: false)).Count > 0) source = "Fundamentus";
                else if ((dividends = await FetchStockAnalysisAsync(ticker)).Count > 0) source = "StockAnalysis";
            }
        }
        catch
        {
            return new FetchResult("error", 0, 0, 0, 0);
        }

        if (dividends.Count == 0)
            return new FetchResult(source, 0, 0, 1, 1);

        var inserted = 0;
        var updated = 0;
        var skipped = 0;
        var existing = await _dividendRepo.GetByAssetIdAsync(assetId);

        var toAdd = new List<AssetDividend>();
        var toUpdate = new List<AssetDividend>();
        var createdAt = DateTime.UtcNow.ToString("yyyy-MM-dd");

        foreach (var div in dividends)
        {
            var paymentDate = string.IsNullOrEmpty(div.PaymentDate) ? div.ComDate : div.PaymentDate;
            var match = existing.FirstOrDefault(d => d.ComDate == div.ComDate);

            if (match != null)
            {
                if (match.GrossAmount.HasValue && Math.Abs(match.GrossAmount.Value - div.GrossAmount) < 0.001)
                {
                    skipped++;
                    continue;
                }

                match.PaymentDate = paymentDate;
                match.GrossAmount = div.GrossAmount;
                match.NetAmount = div.GrossAmount;
                match.Type = div.Type;
                match.Description = "Dividendo";
                toUpdate.Add(match);
                updated++;
            }
            else
            {
                toAdd.Add(new AssetDividend
                {
                    AssetId = assetId,
                    ComDate = div.ComDate,
                    PaymentDate = paymentDate,
                    GrossAmount = div.GrossAmount,
                    NetAmount = div.GrossAmount,
                    Description = "Dividendo",
                    Type = div.Type,
                    CreatedAt = createdAt
                });
                inserted++;
            }
        }

        if (toAdd.Count > 0) await _dividendRepo.AddRangeAsync(toAdd);
        if (toUpdate.Count > 0) await _dividendRepo.UpdateRangeAsync(toUpdate);

        return new FetchResult(source, inserted, updated, skipped, inserted + updated + skipped);
    }

    private async Task<List<FetchedDividend>> FetchInvistaInfoAsync(string ticker)
    {
        var dividends = new List<FetchedDividend>();
        try
        {
            var client = NewClient();
            var url = $"https://invistainfo.com.br/ativo.php?fii={Uri.EscapeDataString(ticker)}";
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode) return dividends;

            var html = await response.Content.ReadAsStringAsync();
            var tables = Regex.Matches(html, "<table[\\s\\S]*?<\\/table>", RegexOptions.IgnoreCase);

            foreach (Match table in tables)
            {
                var rows = Regex.Matches(table.Value, "<tr[^>]*>[\\s\\S]*?<\\/tr>", RegexOptions.IgnoreCase);
                var found = false;

                foreach (Match row in rows)
                {
                    var tds = Regex.Matches(row.Value, "<td[^>]*>([\\s\\S]*?)<\\/td>", RegexOptions.IgnoreCase);
                    if (tds.Count < 3) continue;
                    var cells = tds.Select(t => Regex.Replace(t.Groups[1].Value, "<[^>]+>", "").Trim()).ToList();

                    var comDate = ParseBrDate(cells[0]);
                    if (comDate == null) continue;
                    var payDate = ParseBrDate(cells[1]);
                    var value = ParseBRL(cells[2]);
                    if (value == null || value <= 0) continue;

                    found = true;
                    DividendsAddNew(dividends, new FetchedDividend(comDate, payDate, value.Value, "rendimento"));
                }

                if (found) return dividends;
            }
        }
        catch { }

        return dividends;
    }

    private async Task<List<FetchedDividend>> FetchFundamentusAsync(string ticker, bool isFii)
    {
        var dividends = new List<FetchedDividend>();
        var paths = isFii ? new[] { "fii_proventos" } : new[] { "proventos" };
        var client = NewClient();

        foreach (var path in paths)
        {
            var url = $"https://fundamentus.com.br/{path}.php?papel={Uri.EscapeDataString(ticker)}";
            try
            {
                var response = await client.GetAsync(url);
                if (!response.IsSuccessStatusCode) continue;
                var html = await response.Content.ReadAsStringAsync();
                var rows = Regex.Matches(html, "<tr[^>]*>[\\s\\S]*?<\\/tr>", RegexOptions.IgnoreCase);
                var found = false;

                foreach (Match row in rows)
                {
                    var tds = Regex.Matches(row.Value, "<td[^>]*>([\\s\\S]*?)<\\/td>", RegexOptions.IgnoreCase);
                    if (tds.Count < 4) continue;
                    var cells = tds.Select(t => Regex.Replace(t.Groups[1].Value, "<[^>]+>", "").Trim()).ToList();

                    if (ParseBrDate(cells[0]) == null) continue;

                    string? comDate, payDate;
                    double? value;
                    string type;
                    if (isFii)
                    {
                        comDate = ParseBrDate(cells[0]);
                        type = cells[1].ToLowerInvariant().Contains("amortiz") ? "amortizacao" : "rendimento";
                        payDate = ParseBrDate(cells[2]);
                        value = ParseBRL(cells[3]);
                    }
                    else
                    {
                        comDate = ParseBrDate(cells[0]);
                        value = ParseBRL(cells[1]);
                        type = cells[2].ToLowerInvariant().Contains("jrs") ? "juros" : "rendimento";
                        payDate = ParseBrDate(cells[3]);
                    }
                    if (comDate == null || value == null || value <= 0) continue;

                    found = true;
                    DividendsAddNew(dividends, new FetchedDividend(comDate, payDate, value.Value, type));
                }

                if (found) return dividends;
            }
            catch { continue; }
        }

        return dividends;
    }

    private async Task<List<FetchedDividend>> FetchStockAnalysisAsync(string ticker)
    {
        var dividends = new List<FetchedDividend>();
        try
        {
            var client = NewClient();
            var url = $"https://stockanalysis.com/quote/bvmf/{Uri.EscapeDataString(ticker)}/dividend/";
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode) return dividends;

            var html = await response.Content.ReadAsStringAsync();
            var rows = Regex.Matches(html, "<tr[^>]*>[\\s\\S]*?<\\/tr>", RegexOptions.IgnoreCase);

            foreach (Match row in rows)
            {
                var tds = Regex.Matches(row.Value, "<td[^>]*>([\\s\\S]*?)<\\/td>", RegexOptions.IgnoreCase);
                if (tds.Count < 4) continue;
                var cells = tds.Select(t => Regex.Replace(t.Groups[1].Value, "<[^>]+>", "").Trim()).ToList();

                var comDate = ParseUsDate(cells[0]);
                if (comDate == null) continue;
                var amount = ParseBRL(cells[1]);
                if (amount == null || amount <= 0) continue;
                var payDate = ParseUsDate(cells[3]);

                DividendsAddNew(dividends, new FetchedDividend(comDate, payDate ?? comDate, amount.Value, "rendimento"));
            }
        }
        catch { }

        return dividends;
    }

    private static void DividendsAddNew(List<FetchedDividend> list, FetchedDividend div)
    {
        if (list.Any(d => d.ComDate == div.ComDate && Math.Abs(d.GrossAmount - div.GrossAmount) < 0.001)) return;
        list.Add(div);
    }

    private HttpClient NewClient()
    {
        var client = _httpFactory.CreateClient();
        if (!client.DefaultRequestHeaders.Contains("User-Agent"))
            client.DefaultRequestHeaders.Add("User-Agent", UA);
        client.Timeout = TimeSpan.FromSeconds(60);
        return client;
    }

    private static string? ParseBrDate(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        var match = Regex.Match(raw, @"(\d{2})/(\d{2})/(\d{4})");
        return match.Success ? $"{match.Groups[3]}-{match.Groups[2]}-{match.Groups[1]}" : null;
    }

    private static string? ParseUsDate(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        var match = Regex.Match(raw, @"(\w{3})\s+(\d{1,2}),?\s*(\d{4})");
        if (!match.Success) return null;
        var months = new[] { "", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        var idx = Array.IndexOf(months, months.FirstOrDefault(m => !string.IsNullOrEmpty(m) && m.Equals(match.Groups[1].Value, StringComparison.OrdinalIgnoreCase)));
        if (idx <= 0) return null;
        return $"{match.Groups[3]}-{idx:D2}-{int.Parse(match.Groups[2].Value):D2}";
    }

    private static double? ParseBRL(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var cleaned = Regex.Replace(raw, "[^0-9.,-]", "");
        if (cleaned.Length == 0) return null;

        if (cleaned.Contains(',') && cleaned.Contains('.'))
        {
            var last = cleaned.LastIndexOfAny(new[] { ',', '.' });
            var sep = cleaned[last];
            var other = sep == ',' ? '.' : ',';
            cleaned = cleaned.Replace(other.ToString(), "").Replace(sep, '.');
        }
        else if (cleaned.Contains(','))
        {
            cleaned = cleaned.Replace(',', '.');
        }

        return double.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ? value : null;
    }
}