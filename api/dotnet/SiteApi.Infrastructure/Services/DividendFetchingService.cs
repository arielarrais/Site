using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class DividendFetchingService : IDividendFetchingService
{
    private readonly IAssetRepository _assetRepo;
    private readonly IDividendRepository _dividendRepo;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<DividendFetchingService> _logger;
    private const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    public DividendFetchingService(
        IAssetRepository assetRepo,
        IDividendRepository dividendRepo,
        IHttpClientFactory httpFactory,
        ILogger<DividendFetchingService> logger)
    {
        _assetRepo = assetRepo;
        _dividendRepo = dividendRepo;
        _httpFactory = httpFactory;
        _logger = logger;
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
            (dividends, source) = await FetchCombinedAsync(ticker, isFii);
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
            if (match == null && !string.IsNullOrEmpty(paymentDate))
                match = existing.FirstOrDefault(d => d.PaymentDate == paymentDate);

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

    private async Task<(List<FetchedDividend> Dividends, string Source)> FetchCombinedAsync(string ticker, bool isFii)
    {
        var result = new List<FetchedDividend>();
        var source = "";
        var newestSource = "";

        var candidates = new List<(string Name, Func<Task<List<FetchedDividend>>> Fetch)>();
        if (isFii) candidates.Add(("InvistaInfo", () => FetchInvistaInfoAsync(ticker)));
        candidates.Add(("Fundamentus", () => FetchFundamentusAsync(ticker, isFii)));
        candidates.Add(("StockAnalysis", () => FetchStockAnalysisAsync(ticker)));

        var baselineOk = false;
        string? baseMaxPay = null;
        string? newestPay = null;

        foreach (var (name, fetch) in candidates)
        {
            List<FetchedDividend> data;
            try { data = await fetch(); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Falha ao buscar dividendos de {Ticker} em {Source}", ticker, name);
                continue;
            }
            if (data.Count == 0)
            {
                _logger.LogWarning("Fonte {Source} retornou 0 proventos para {Ticker}", name, ticker);
                continue;
            }

            if (!baselineOk)
            {
                result.AddRange(data);
                baseMaxPay = data.Max(d => d.PaymentDate ?? d.ComDate);
                newestPay = baseMaxPay;
                newestSource = name;
                baselineOk = true;
                continue;
            }

            // A fonte principal pode estar desatualizada. Complementa com o historico
            // mais recente das demais fontes, sem duplicar proventos ja consolidados.
            foreach (var div in data)
            {
                var pay = div.PaymentDate ?? div.ComDate;
                if (baseMaxPay == null || string.Compare(pay, baseMaxPay, StringComparison.Ordinal) > 0)
                {
                    result.Add(div);
                    if (newestPay == null || string.Compare(pay, newestPay, StringComparison.Ordinal) > 0)
                    {
                        newestPay = pay;
                        newestSource = name;
                    }
                }
            }
        }

        return (result, newestSource ?? source);
    }

    private async Task<List<FetchedDividend>> FetchInvistaInfoAsync(string ticker)
    {
        var dividends = new List<FetchedDividend>();
        try
        {
            var client = NewClient();
            var url = $"https://invistainfo.com.br/ativo.php?fii={Uri.EscapeDataString(ticker)}";
            var html = await GetHtmlWithRetryAsync(client, url, "InvistaInfo", ticker);
            if (html == null) return dividends;

            var tables = Regex.Matches(html, "<table[\\s\\S]*?<\\/table>", RegexOptions.IgnoreCase);

            // A pagina tem varias tabelas: a primeira e apenas o "ultimo rendimento" (1 linha),
            // o historico vem depois. Percorrer todas e exigir data na segunda coluna evita
            // pegar a tabela de comunicados e garante o historico completo.
            foreach (Match table in tables)
            {
                var rows = Regex.Matches(table.Value, "<tr[^>]*>[\\s\\S]*?<\\/tr>", RegexOptions.IgnoreCase);

                foreach (Match row in rows)
                {
                    var tds = Regex.Matches(row.Value, "<td[^>]*>([\\s\\S]*?)<\\/td>", RegexOptions.IgnoreCase);
                    if (tds.Count < 3) continue;
                    var cells = tds.Select(t => Regex.Replace(t.Groups[1].Value, "<[^>]+>", "").Trim()).ToList();

                    var comDate = ParseBrDate(cells[0]);
                    var payDate = ParseBrDate(cells[1]);
                    var value = ParseBRL(cells[2]);
                    if (comDate == null || payDate == null || value == null || value <= 0) continue;

                    DividendsAddNew(dividends, new FetchedDividend(comDate, payDate, value.Value, "rendimento"));
                }
            }
        }
        catch (Exception ex) { _logger.LogWarning(ex, "InvistaInfo {Ticker}: erro", ticker); }

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
                var html = await GetHtmlWithRetryAsync(client, url, "Fundamentus", ticker);
                if (html == null) continue;
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
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Fundamentus {Ticker} ({Path}): erro", ticker, path);
                continue;
            }
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
            var html = await GetHtmlWithRetryAsync(client, url, "StockAnalysis", ticker);
            if (html == null) return dividends;

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
        catch (Exception ex) { _logger.LogWarning(ex, "StockAnalysis {Ticker}: erro", ticker); }

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

    // Faz a requisicao tratando limite de taxa (HTTP 429) e erros temporarios (5xx)
    // com espera progressiva (respeitando Retry-After quando presente).
    private async Task<string?> GetHtmlWithRetryAsync(HttpClient client, string url, string source, string ticker)
    {
        const int maxAttempts = 5;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                using var response = await client.GetAsync(url);
                if (response.IsSuccessStatusCode)
                    return await response.Content.ReadAsStringAsync();

                var status = (int)response.StatusCode;
                if (status != 429 && status < 500)
                {
                    _logger.LogWarning("{Source} {Ticker}: HTTP {Status}", source, ticker, status);
                    return null;
                }

                var wait = response.Headers.RetryAfter?.Delta
                           ?? TimeSpan.FromSeconds(Math.Min(30 * attempt, 90));
                _logger.LogWarning("{Source} {Ticker}: HTTP {Status}, aguardando {Wait}s (tentativa {Attempt}/{Max})",
                    source, ticker, status, (int)wait.TotalSeconds, attempt, maxAttempts);
                await Task.Delay(wait);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "{Source} {Ticker}: erro (tentativa {Attempt}/{Max})", source, ticker, attempt, maxAttempts);
                await Task.Delay(TimeSpan.FromSeconds(3 * attempt));
            }
        }

        return null;
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