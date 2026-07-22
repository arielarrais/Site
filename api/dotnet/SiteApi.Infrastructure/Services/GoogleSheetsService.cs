using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class GoogleSheetsService : IGoogleSheetsService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;

    public GoogleSheetsService(IHttpClientFactory httpFactory, IConfiguration config)
    {
        _httpFactory = httpFactory;
        _config = config;
    }

    public async Task<Dictionary<string, object>> GetSheetPricesAsync(string url, string? apiKey)
    {
        apiKey ??= _config["GoogleApiKey"] ?? "";

        if (!string.IsNullOrEmpty(apiKey))
        {
            var sheetId = ExtractSheetId(url);
            if (sheetId != null)
            {
                try
                {
                    var values = await FetchSheetViaApi(sheetId, apiKey, null);
                    return ParseSheetRows(values.Select(r => string.Join("\t", r)).ToList());
                }
                catch { }
            }
        }

        var csvUrl = url.Contains("/export?format=csv") ? url : Regex.Replace(url, @"/edit.*$", "") + "/export?format=csv";
        var lines = await FetchSheetCSV(csvUrl);
        return ParseSheetRows(lines);
    }

    private static string? ExtractSheetId(string url)
    {
        var match = Regex.Match(url, @"/d/([a-zA-Z0-9_-]+)");
        return match.Success ? match.Groups[1].Value : null;
    }

    private async Task<List<string[]>> FetchSheetViaApi(string spreadsheetId, string apiKey, string? gid)
    {
        var client = _httpFactory.CreateClient();
        var metaUrl = $"https://sheets.googleapis.com/v4/spreadsheets/{Uri.EscapeDataString(spreadsheetId)}?key={Uri.EscapeDataString(apiKey)}";
        var metaRes = await client.GetAsync(metaUrl);
        if (!metaRes.IsSuccessStatusCode) throw new Exception($"Google API {metaRes.StatusCode}");
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

    private static double ParseSheetPrice(string str)
    {
        str = (str ?? "").Trim().Replace("R$", "").Replace(" ", "");
        if (string.IsNullOrEmpty(str)) return double.NaN;
        var lastDot = str.LastIndexOf('.');
        var lastComma = str.LastIndexOf(',');
        if (lastDot > -1 && lastComma > -1)
        {
            if (lastComma > lastDot) str = str.Replace(".", "").Replace(",", ".");
            else str = str.Replace(",", "");
        }
        else if (lastComma > -1) str = str.Replace(",", ".");

        if (double.TryParse(str, NumberStyles.Float, CultureInfo.InvariantCulture, out var val)) return val;
        return double.NaN;
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
        var precoIndices = headers.Select((h, i) => (h, i))
            .Where(x => x.h.Contains("PREÇO") || x.h.Contains("PRECO") || x.h.Contains("PREÇ") || x.h.Contains("ATUAL"))
            .Select(x => x.i).ToList();
        var nomeIdx = Array.FindIndex(headers, h => h == "NOME" || h.Contains("NOME") || h.Contains("NAME"));

        if (fundosIdx < 0 || !precoIndices.Any())
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

            prices[ticker] = new { ticker, price = (!double.IsNaN(price) && price > 0) ? (double?)price : null, name };
        }
        return prices;
    }
}
