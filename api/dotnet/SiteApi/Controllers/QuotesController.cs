using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace SiteApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class QuotesController : ControllerBase
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;

    public QuotesController(IHttpClientFactory httpFactory, IConfiguration config)
    {
        _httpFactory = httpFactory;
        _config = config;
    }

    private const string YahooUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private string BrapiToken => _config["BrapiToken"] ?? "";

    private static readonly ConcurrentDictionary<string, (object data, long timestamp)> _sheetCache = new();
    private const long CacheDurationMs = 300_000;

    [HttpGet("~/api/quote")]
    public async Task<IActionResult> GetQuote([FromQuery] string? ticker)
    {
        var t = (ticker ?? "").Trim().ToUpper();
        if (string.IsNullOrEmpty(t))
            return BadRequest(new { error = "Ticker é obrigatório." });

        try
        {
            var client = _httpFactory.CreateClient();
            var token = BrapiToken;
            var url = $"https://brapi.dev/api/quote/{Uri.EscapeDataString(t)}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime";
            if (!string.IsNullOrEmpty(token)) url += $"&token={Uri.EscapeDataString(token)}";

            var response = await client.GetAsync(url);
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            var quote = doc.RootElement.TryGetProperty("results", out var results) && results.GetArrayLength() > 0
                ? results[0] : default;

            if (!response.IsSuccessStatusCode || quote.ValueKind == JsonValueKind.Undefined ||
                !quote.TryGetProperty("regularMarketPrice", out var rmp) || rmp.ValueKind == JsonValueKind.Null)
            {
                try
                {
                    var altUrl = $"https://api.brapi.dev/api/quote/{Uri.EscapeDataString(t)}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime";
                    var altRes = await client.GetAsync(altUrl);
                    if (altRes.IsSuccessStatusCode)
                    {
                        var altJson = await altRes.Content.ReadAsStringAsync();
                        var altDoc = JsonDocument.Parse(altJson);
                        if (altDoc.RootElement.TryGetProperty("results", out var altResults) && altResults.GetArrayLength() > 0)
                        {
                            quote = altResults[0];
                            response = altRes;
                        }
                    }
                }
                catch { }
            }

            if (!response.IsSuccessStatusCode)
                return StatusCode(502, new { error = "Falha ao buscar preço externo." });

            if (quote.ValueKind == JsonValueKind.Undefined || quote.ValueKind == JsonValueKind.Null ||
                !quote.TryGetProperty("regularMarketPrice", out var priceProp) || priceProp.ValueKind == JsonValueKind.Null)
                return NotFound(new { error = "Preço não encontrado." });

            var name = quote.TryGetProperty("shortName", out var sn) ? sn.GetString() ?? t : t;
            var changePercent = quote.TryGetProperty("changePercent", out var cp) && cp.ValueKind != JsonValueKind.Null ? cp.GetDouble() : (double?)null;
            var time = quote.TryGetProperty("regularMarketTime", out var rmt) && rmt.ValueKind != JsonValueKind.Null ? rmt.ToString() : null;

            return Ok(new { ticker = t, price = priceProp.GetDouble(), name, changePercent, time });
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar cotações." });
        }
    }

    [HttpGet("~/api/quotes")]
    public async Task<IActionResult> GetQuotes([FromQuery] string? tickers)
    {
        var tickerList = (tickers ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim().ToUpper())
            .Where(t => !string.IsNullOrEmpty(t))
            .ToList();

        if (!tickerList.Any())
            return BadRequest(new { error = "Tickers são obrigatórios." });

        try
        {
            var client = _httpFactory.CreateClient();
            var token = BrapiToken;
            var tickerParam = string.Join(",", tickerList.Select(Uri.EscapeDataString));
            var url = $"https://brapi.dev/api/quote/{tickerParam}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime";
            if (!string.IsNullOrEmpty(token)) url += $"&token={Uri.EscapeDataString(token)}";

            var response = await client.GetAsync(url);
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            var quotes = doc.RootElement.TryGetProperty("results", out var results) ? results.EnumerateArray().ToList() : new();

            if (!response.IsSuccessStatusCode || !quotes.Any())
            {
                try
                {
                    var altUrl = $"https://api.brapi.dev/api/quote/{tickerParam}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime";
                    var altRes = await client.GetAsync(altUrl);
                    if (altRes.IsSuccessStatusCode)
                    {
                        var altJson = await altRes.Content.ReadAsStringAsync();
                        var altDoc = JsonDocument.Parse(altJson);
                        if (altDoc.RootElement.TryGetProperty("results", out var altResults))
                        {
                            quotes = altResults.EnumerateArray().ToList();
                            response = altRes;
                        }
                    }
                }
                catch { }
            }

            if (!response.IsSuccessStatusCode)
                return StatusCode(502, new { error = "Falha ao buscar preços externos." });

            var mapped = new Dictionary<string, object>();
            foreach (var q in quotes)
            {
                if (q.TryGetProperty("symbol", out var symProp))
                {
                    var sym = symProp.GetString()?.ToUpper() ?? "";
                    var price = q.TryGetProperty("regularMarketPrice", out var p) && p.ValueKind != JsonValueKind.Null ? p.GetDouble() : 0;
                    var name = q.TryGetProperty("shortName", out var sn) ? sn.GetString() ?? sym : sym;
                    var cp = q.TryGetProperty("changePercent", out var cpP) && cpP.ValueKind != JsonValueKind.Null ? cpP.GetDouble() : (double?)null;
                    var tm = q.TryGetProperty("regularMarketTime", out var tmP) && tmP.ValueKind != JsonValueKind.Null ? tmP.ToString() : null;
                    mapped[sym] = new { ticker = sym, price, name, changePercent = cp, time = tm };
                }
            }
            return Ok(mapped);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar cotações." });
        }
    }

    [HttpGet("~/api/quote/yahoo")]
    public async Task<IActionResult> GetYahooQuote([FromQuery] string? ticker)
    {
        var t = (ticker ?? "").Trim().ToUpper();
        if (string.IsNullOrEmpty(t))
            return BadRequest(new { error = "Ticker é obrigatório." });

        try
        {
            var yahooTicker = t.Contains('.') ? t : $"{t}.SA";
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Add("User-Agent", YahooUA);
            var response = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?interval=1d&range=1d");
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            var meta = doc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");

            if (!meta.TryGetProperty("regularMarketPrice", out var priceProp) || priceProp.ValueKind == JsonValueKind.Null)
                return NotFound(new { error = "Preço não encontrado no Yahoo Finance." });

            var instrumentType = meta.TryGetProperty("instrumentType", out var it) ? it.GetString() : null;

            return Ok(new
            {
                ticker = t,
                price = priceProp.GetDouble(),
                name = meta.TryGetProperty("symbol", out var s) ? s.GetString() : t,
                changePercent = (double?)null,
                time = (string?)null,
                instrumentType
            });
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar preço no Yahoo Finance." });
        }
    }

    [HttpGet("~/api/quotes/yahoo")]
    public async Task<IActionResult> GetYahooQuotes([FromQuery] string? tickers)
    {
        var tickerList = (tickers ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim().ToUpper())
            .Where(t => !string.IsNullOrEmpty(t))
            .ToList();

        if (!tickerList.Any())
            return BadRequest(new { error = "Tickers são obrigatórios." });

        try
        {
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Add("User-Agent", YahooUA);

            var tasks = tickerList.Select(async t =>
            {
                try
                {
                    var yahooTicker = t.Contains('.') ? t : $"{t}.SA";
                    var response = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?interval=1d&range=1d");
                    var json = await response.Content.ReadAsStringAsync();
                    var doc = JsonDocument.Parse(json);
                    var meta = doc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");
                    var price = meta.TryGetProperty("regularMarketPrice", out var p) && p.ValueKind != JsonValueKind.Null
                        ? (double?)p.GetDouble() : null;
                    return (ticker: t, price);
                }
                catch
                {
                    return (ticker: t, price: (double?)null);
                }
            });

            var results = await Task.WhenAll(tasks);
            var mapped = new Dictionary<string, object>();
            foreach (var r in results)
            {
                if (r.price.HasValue)
                    mapped[r.ticker] = new { ticker = r.ticker, price = r.price.Value, name = r.ticker, changePercent = (double?)null, time = (string?)null };
            }
            return Ok(mapped);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar preços no Yahoo Finance." });
        }
    }

    [HttpGet("~/api/quotes/sheets")]
    public async Task<IActionResult> GetSheetPrices([FromQuery] string? url, [FromQuery] string? key)
    {
        if (string.IsNullOrEmpty(url))
            return BadRequest(new { error = "URL da planilha é obrigatória." });

        var cacheKey = url;
        if (_sheetCache.TryGetValue(cacheKey, out var cached) && (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - cached.timestamp) < CacheDurationMs)
            return Ok(cached.data);

        try
        {
            var apiKey = key ?? _config["GoogleApiToken"] ?? "";
            Dictionary<string, object> prices = new();

            if (!string.IsNullOrEmpty(apiKey))
            {
                var sheetId = ExtractSheetId(url);
                if (sheetId != null)
                {
                    var gid = ExtractGid(url);
                    try
                    {
                        var values = await FetchSheetViaApi(sheetId, apiKey, gid);
                        prices = ParseSheetRows(values.Select(r => string.Join("\t", r)).ToList());
                    }
                    catch { }
                }
            }

            if (!prices.Any())
            {
                var csvUrl = url.Contains("/export?format=csv") ? url : Regex.Replace(url, @"/edit.*$", "") + "/export?format=csv";
                var lines = await FetchSheetCSV(csvUrl);
                prices = ParseSheetRows(lines);
            }

            _sheetCache[cacheKey] = (prices, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            return Ok(prices);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar preços da planilha." });
        }
    }

    private static string? ExtractSheetId(string url)
    {
        var match = Regex.Match(url, @"/d/([a-zA-Z0-9_-]+)");
        return match.Success ? match.Groups[1].Value : null;
    }

    private static string? ExtractGid(string url)
    {
        var match = Regex.Match(url, @"[?#&]gid=(\d+)");
        return match.Success ? match.Groups[1].Value : null;
    }

    private static double ParseSheetPrice(string str)
    {
        str = (str ?? "").Trim().Replace("R$", "").Replace(" ", "");
        if (string.IsNullOrEmpty(str)) return double.NaN;
        var lastDot = str.LastIndexOf('.');
        var lastComma = str.LastIndexOf(',');
        if (lastDot > -1 && lastComma > -1)
        {
            if (lastComma > lastDot)
                str = str.Replace(".", "").Replace(",", ".");
            else
                str = str.Replace(",", "");
        }
        else if (lastComma > -1)
            str = str.Replace(",", ".");

        if (double.TryParse(str, NumberStyles.Float, CultureInfo.InvariantCulture, out var val))
            return val;
        return double.NaN;
    }

    private async Task<List<string[]>> FetchSheetViaApi(string spreadsheetId, string apiKey, string? gid)
    {
        var client = _httpFactory.CreateClient();
        var metaUrl = $"https://sheets.googleapis.com/v4/spreadsheets/{Uri.EscapeDataString(spreadsheetId)}?key={Uri.EscapeDataString(apiKey)}";
        var metaRes = await client.GetAsync(metaUrl);
        if (!metaRes.IsSuccessStatusCode)
            throw new Exception($"Google API {metaRes.StatusCode}");
        var metaJson = await metaRes.Content.ReadAsStringAsync();
        var meta = JsonDocument.Parse(metaJson);

        var sheets = meta.RootElement.GetProperty("sheets");
        var sheet = sheets[0];
        if (gid != null)
        {
            foreach (var s in sheets.EnumerateArray())
            {
                if (s.GetProperty("properties").TryGetProperty("sheetId", out var sid) && sid.ToString() == gid)
                { sheet = s; break; }
            }
        }
        var sheetName = sheet.GetProperty("properties").GetProperty("title").GetString();
        if (string.IsNullOrEmpty(sheetName)) throw new Exception("Sheet name not found");

        var range = $"{Uri.EscapeDataString(sheetName)}!A:Z";
        var dataUrl = $"https://sheets.googleapis.com/v4/spreadsheets/{Uri.EscapeDataString(spreadsheetId)}/values/{range}?key={Uri.EscapeDataString(apiKey)}";
        var dataRes = await client.GetAsync(dataUrl);
        if (!dataRes.IsSuccessStatusCode) throw new Exception($"Google API {dataRes.StatusCode}");
        var dataJson = await dataRes.Content.ReadAsStringAsync();
        var dataDoc = JsonDocument.Parse(dataJson);
        var values = dataDoc.RootElement.GetProperty("values");

        var rows = new List<string[]>();
        foreach (var row in values.EnumerateArray())
        {
            var cols = new List<string>();
            foreach (var cell in row.EnumerateArray())
                cols.Add(cell.GetString() ?? "");
            rows.Add(cols.ToArray());
        }
        return rows;
    }

    private async Task<List<string>> FetchSheetCSV(string csvUrl)
    {
        var client = _httpFactory.CreateClient();
        var csv = await client.GetStringAsync(csvUrl);
        return csv.Split('\n').Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
    }

    private static string CsvSplitLine(string line, char sep)
    {
        if (sep == '\t') return string.Join("\t", line.Split('\t').Select(c => c.Trim().Trim('"')));
        var fields = new List<string>();
        var cur = new System.Text.StringBuilder();
        bool inQuote = false;
        for (int j = 0; j < line.Length; j++)
        {
            var ch = line[j];
            if (inQuote)
            {
                if (ch == '"')
                {
                    if (j + 1 < line.Length && line[j + 1] == '"') { cur.Append('"'); j++; }
                    else inQuote = false;
                }
                else cur.Append(ch);
            }
            else
            {
                if (ch == '"') inQuote = true;
                else if (ch == sep) { fields.Add(cur.ToString().Trim()); cur.Clear(); }
                else cur.Append(ch);
            }
        }
        fields.Add(cur.ToString().Trim());
        return string.Join("\t", fields.Select(c => c.Trim('"')));
    }

    private static Dictionary<string, object> ParseSheetRows(List<string> lines)
    {
        if (!lines.Any()) return new();
        var headerLine = lines[0];
        char sep = ',';
        foreach (var s in new[] { ',', ';', '\t' })
        {
            if (headerLine.Split(s).Length >= 3) { sep = s; break; }
        }

        var headerParts = CsvSplitLine(headerLine, sep).Split('\t');
        var headers = headerParts.Select(h => h.Trim().ToUpperInvariant()).ToArray();

        var fundosIdx = Array.FindIndex(headers, h => h.Contains("FUNDO") || h == "TICKER" || h == "ATIVO" || h == "AÇÃO" || h == "ACAO");
        var precoIdx = Array.FindIndex(headers, h => h.Contains("PREÇO") || h.Contains("PRECO") || h.Contains("ATUAL"));
        var precoIndices = headers.Select((h, i) => (h, i))
            .Where(x => x.h.Contains("PREÇO") || x.h.Contains("PRECO") || x.h.Contains("PREÇ") || x.h.Contains("ATUAL"))
            .Select(x => x.i).ToList();
        var nomeIdx = Array.FindIndex(headers, h => h == "NOME" || h.Contains("NOME") || h.Contains("NAME"));

        if (fundosIdx < 0 || precoIdx < 0)
            throw new Exception("Colunas FUNDOS e PREÇO ATUAL não encontradas na planilha.");

        var prices = new Dictionary<string, object>();
        for (int i = 1; i < lines.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i])) continue;
            var cols = CsvSplitLine(lines[i], sep).Split('\t');
            var ticker = cols.Length > fundosIdx ? cols[fundosIdx]?.Trim().ToUpper() : null;
            if (string.IsNullOrEmpty(ticker)) continue;

            double price = double.NaN;
            foreach (var pi in precoIndices)
            {
                if (pi < cols.Length)
                {
                    var priceStr = cols[pi]?.Trim();
                    if (!string.IsNullOrEmpty(priceStr))
                    {
                        price = ParseSheetPrice(priceStr);
                        if (!double.IsNaN(price) && price > 0) break;
                    }
                }
            }

            var name = (nomeIdx >= 0 && nomeIdx < cols.Length && !string.IsNullOrEmpty(cols[nomeIdx]?.Trim()))
                ? cols[nomeIdx].Trim() : ticker;
            if (Regex.IsMatch(name, @"^#N/A|^#ERROR|^#REF")) name = ticker;

            prices[ticker] = new
            {
                ticker,
                price = (!double.IsNaN(price) && price > 0) ? (double?)price : null,
                name,
                changePercent = (double?)null,
                time = (string?)null
            };
        }
        return prices;
    }
}
