using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SiteApi.Data;
using SiteApi.Models;

namespace SiteApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AdminController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;

    private static bool _fetchRunning;
    private static bool _syncRunning;
    private static bool _fixRunning;

    private const string YahooUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private string BrapiToken => _config["BrapiToken"] ?? "";

    public AdminController(AppDbContext db, IHttpClientFactory httpFactory, IConfiguration config)
    {
        _db = db;
        _httpFactory = httpFactory;
        _config = config;
    }

    private static string? ParseBRDate(string s)
    {
        var match = Regex.Match(s, @"(\d{2})/(\d{2})/(\d{4})");
        return match.Success ? $"{match.Groups[3].Value}-{match.Groups[2].Value}-{match.Groups[1].Value}" : null;
    }

    private static string? ParseUSDate(string s)
    {
        var match = Regex.Match(s, @"(\w{3})\s+(\d{1,2}),?\s*(\d{4})");
        if (!match.Success) return null;
        var months = new Dictionary<string, string>
        {
            {"Jan","01"},{"Feb","02"},{"Mar","03"},{"Apr","04"},{"May","05"},{"Jun","06"},
            {"Jul","07"},{"Aug","08"},{"Sep","09"},{"Oct","10"},{"Nov","11"},{"Dec","12"}
        };
        var mon = match.Groups[1].Value;
        if (!months.ContainsKey(mon)) return null;
        return $"{match.Groups[3].Value}-{months[mon]}-{int.Parse(match.Groups[2].Value):D2}";
    }

    [HttpGet("assets")]
    public async Task<IActionResult> GetAdminAssets()
    {
        try
        {
            var assets = await (from a in _db.B3Assets
                                select new
                                {
                                    id = a.Id,
                                    ticker = a.Ticker,
                                    name = a.Name,
                                    assettype = a.Assettype,
                                    fiitype = a.Fiitype,
                                    lastcomdate = _db.AssetDividends
                                        .Where(d => d.Assetid == a.Id)
                                        .OrderByDescending(d => d.Paymentdate)
                                        .Select(d => d.Comdate)
                                        .FirstOrDefault(),
                                    lastdividenddate = _db.AssetDividends
                                        .Where(d => d.Assetid == a.Id)
                                        .Max(d => d.Paymentdate),
                                    lastdividendvalue = _db.AssetDividends
                                        .Where(d => d.Assetid == a.Id)
                                        .OrderByDescending(d => d.Paymentdate)
                                        .Select(d => d.Grossamount)
                                        .FirstOrDefault()
                                })
                                .OrderBy(a => a.assettype).ThenBy(a => a.ticker)
                                .ToListAsync();
            return Ok(assets);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar ativos." });
        }
    }

    [HttpGet("dividends")]
    public async Task<IActionResult> GetAdminDividends([FromQuery] int? assetId)
    {
        try
        {
            var query = _db.AssetDividends.AsQueryable();
            if (assetId.HasValue && assetId.Value > 0)
                query = query.Where(d => d.Assetid == assetId.Value);

            var result = await query.OrderByDescending(d => d.Paymentdate)
                .Select(d => new
                {
                    id = d.Id,
                    assetid = d.Assetid,
                    paymentdate = d.Paymentdate,
                    grossamount = d.Grossamount,
                    netamount = d.Netamount,
                    description = d.Description,
                    type = d.Type,
                    createdat = d.Createdat
                }).ToListAsync();
            return Ok(result);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar dividendos." });
        }
    }

    [HttpPost("dividends")]
    public async Task<IActionResult> CreateAdminDividend([FromBody] AdminDividendRequest req)
    {
        if (req.AssetId <= 0 || string.IsNullOrEmpty(req.ComDate) || string.IsNullOrEmpty(req.PaymentDate) || req.GrossAmount <= 0)
            return BadRequest(new { error = "assetId, comDate, paymentDate e grossAmount são obrigatórios." });

        if (!Regex.IsMatch(req.ComDate, @"^\d{4}-\d{2}-\d{2}$"))
            return BadRequest(new { error = "Data COM deve estar no formato YYYY-MM-DD." });
        if (!Regex.IsMatch(req.PaymentDate, @"^\d{4}-\d{2}-\d{2}$"))
            return BadRequest(new { error = "Data pgto deve estar no formato YYYY-MM-DD." });

        try
        {
            var dividend = new AssetDividend
            {
                Assetid = req.AssetId,
                Comdate = req.ComDate,
                Paymentdate = req.PaymentDate,
                Grossamount = req.GrossAmount,
                Type = req.Type ?? "dividendo"
            };
            _db.AssetDividends.Add(dividend);
            await _db.SaveChangesAsync();

            return Ok(new { id = dividend.Id, assetId = dividend.Assetid, comDate = dividend.Comdate, paymentDate = dividend.Paymentdate, grossAmount = dividend.Grossamount, type = dividend.Type });
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao salvar dividendo." });
        }
    }

    [HttpGet("sync-brapi")]
    public async Task<IActionResult> SyncBrapi([FromQuery] string? ticker)
    {
        var t = (ticker ?? "").Trim().ToUpper();
        if (string.IsNullOrEmpty(t))
            return BadRequest(new { error = "Ticker é obrigatório." });

        try
        {
            var client = _httpFactory.CreateClient();
            var token = BrapiToken;
            var url = $"https://brapi.dev/api/quote/{Uri.EscapeDataString(t)}?token={Uri.EscapeDataString(token)}";
            var response = await client.GetAsync(url);
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("results", out var results) && results.GetArrayLength() > 0)
            {
                var quote = results[0];
                var shortName = quote.TryGetProperty("shortName", out var sn) ? sn.GetString() : null;
                var longName = quote.TryGetProperty("longName", out var ln) ? ln.GetString() : null;
                var logourl = quote.TryGetProperty("logourl", out var lo) ? lo.GetString() : null;
                var price = quote.TryGetProperty("regularMarketPrice", out var rp) ? rp.ToString() : null;

                var asset = await _db.B3Assets.FirstOrDefaultAsync(a => a.Ticker == t);
                if (asset != null)
                {
                    asset.Name = shortName ?? t;
                    asset.Longname = longName;
                    asset.Logourl = logourl;
                    asset.Regularmarketprice = price;
                    await _db.SaveChangesAsync();
                }

                return Ok(new { ticker = t, name = shortName, longName, price = quote.TryGetProperty("regularMarketPrice", out var r) && r.ValueKind != JsonValueKind.Null ? r.GetDouble() : (double?)null });
            }
        }
        catch { }

        // Fallback Yahoo
        try
        {
            var yahooTicker = t.Contains('.') ? t : $"{t}.SA";
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Add("User-Agent", YahooUA);
            var yRes = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?interval=1d&range=1d");
            if (!yRes.IsSuccessStatusCode)
                return StatusCode(502, new { error = $"Brapi e Yahoo indisponiveis para {t}" });

            var yJson = await yRes.Content.ReadAsStringAsync();
            var yDoc = JsonDocument.Parse(yJson);
            var meta = yDoc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");

            var name = (meta.TryGetProperty("shortName", out var sn2) ? sn2.GetString() : null) ?? t;
            name = name.Length > 255 ? name[..255] : name;
            string? longName2 = null;
            if (meta.TryGetProperty("longName", out var ln2))
            {
                longName2 = ln2.GetString();
                if (longName2?.Length > 255) longName2 = longName2[..255];
            }
            var price2 = meta.TryGetProperty("regularMarketPrice", out var rp2) ? rp2.ToString() : null;

            var asset = await _db.B3Assets.FirstOrDefaultAsync(a => a.Ticker == t);
            if (asset != null)
            {
                asset.Name = name;
                asset.Longname = longName2;
                asset.Regularmarketprice = price2;
                await _db.SaveChangesAsync();
            }

            var priceVal = meta.TryGetProperty("regularMarketPrice", out var pv) && pv.ValueKind != JsonValueKind.Null ? pv.GetDouble() : (double?)null;
            return Ok(new { ticker = t, name, longName = longName2, price = priceVal });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = $"Brapi e Yahoo indisponiveis para {t}: {ex.Message}" });
        }
    }

    [HttpPost("fetch-dividends")]
    public async Task<IActionResult> FetchDividends([FromBody] FetchDividendsRequest req)
    {
        var ticker = (req.Ticker ?? "").Trim().ToUpper();
        if (string.IsNullOrEmpty(ticker))
            return BadRequest(new { error = "Ticker é obrigatório." });

        try
        {
            var asset = await _db.B3Assets.FirstOrDefaultAsync(a => a.Ticker == ticker);
            if (asset == null)
                return NotFound(new { error = "Ativo não encontrado no banco." });

            var result = await FetchAndSyncAssetDividends(asset.Id, ticker);
            return Ok(new { ticker, result });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("fetch-all-dividends")]
    public async Task<IActionResult> FetchAllDividends()
    {
        if (_fetchRunning)
            return BadRequest(new { error = "Já existe uma busca em andamento." });

        var assets = await _db.B3Assets.OrderBy(a => a.Ticker).Select(a => new { a.Id, a.Ticker }).ToListAsync();
        _fetchRunning = true;

        _ = Task.Run(async () =>
        {
            try
            {
                foreach (var a in assets)
                {
                    try
                    {
                        await FetchAndSyncAssetDividends(a.Id, a.Ticker);
                    }
                    catch { }
                }
            }
            finally { _fetchRunning = false; }
        });

        return Ok(new { total = assets.Count, message = "Sincronização iniciada em segundo plano." });
    }

    [HttpPost("sync-dividends")]
    public async Task<IActionResult> SyncDividends()
    {
        if (_syncRunning)
            return BadRequest(new { error = "Já existe uma sincronização em andamento." });

        _syncRunning = true;
        _ = Task.Run(async () =>
        {
            try
            {
                var assets = await _db.B3Assets.OrderBy(a => a.Ticker).ToListAsync();
                foreach (var a in assets)
                {
                    try { await FetchAndSyncAssetDividends(a.Id, a.Ticker); }
                    catch { }
                }
            }
            finally { _syncRunning = false; }
        });

        return Ok(new { message = "Sincronização de dividendos iniciada em segundo plano." });
    }

    [HttpPost("fix-payment-dates")]
    public async Task<IActionResult> FixPaymentDates()
    {
        if (_fixRunning)
            return BadRequest(new { error = "Já existe uma correção em andamento." });

        _fixRunning = true;
        _ = Task.Run(async () =>
        {
            try { await RunFixPaymentDates(); }
            finally { _fixRunning = false; }
        });

        return Ok(new { message = "Correção de datas de pagamento iniciada em segundo plano." });
    }

    [HttpPost("sync-tickers-sheet")]
    public async Task<IActionResult> SyncTickersSheet()
    {
        try
        {
            var sheetUrl = "https://docs.google.com/spreadsheets/d/1Kzhcn6A8Kmd6SqEDM87gHbyb6HoDGzxXr5vsi1pIu44/export?format=csv";
            var apiKey = _config["GoogleApiKey"] ?? "";
            Dictionary<string, JsonElement> prices = new();

            if (!string.IsNullOrEmpty(apiKey))
            {
                var sheetId = ExtractSheetId(sheetUrl);
                if (sheetId != null)
                {
                    try
                    {
                        var values = await FetchSheetViaApi(sheetId, apiKey, null);
                        prices = ParseSheetRowsForSync(values);
                    }
                    catch { }
                }
            }

            if (!prices.Any())
            {
                var lines = await FetchSheetCSV(sheetUrl);
                prices = ParseSheetCSVForSync(lines);
            }

            var tickers = prices.Keys.ToList();
            if (!tickers.Any())
                return BadRequest(new { error = "Nenhum ticker encontrado na planilha." });

            int inserted = 0, updated = 0;
            var logLines = new List<string>();

            foreach (var ticker in tickers)
            {
                var info = prices[ticker];
                var priceVal = info.TryGetProperty("price", out var pVal) && pVal.ValueKind != JsonValueKind.Null ? pVal.GetDouble().ToString() : null;
                var name = info.TryGetProperty("name", out var nVal) ? nVal.GetString() ?? ticker : ticker;

                var existing = await _db.B3Assets.FirstOrDefaultAsync(a => a.Ticker == ticker);
                if (existing != null)
                {
                    existing.Regularmarketprice = priceVal;
                    existing.Name = name;
                    updated++;
                    logLines.Add($"  {ticker} -> atualizado (preco: {priceVal})");
                }
                else
                {
                    var assettype = ticker.EndsWith("11") ? "fii" : "acao";
                    _db.B3Assets.Add(new B3Asset { Ticker = ticker, Name = name, Assettype = assettype, Regularmarketprice = priceVal });
                    inserted++;
                    logLines.Add($"  {ticker} -> inserido ({assettype}, preco: {priceVal})");
                }
            }
            await _db.SaveChangesAsync();

            return Ok(new { inserted, updated, total = tickers.Count, log = string.Join("\n", logLines) });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Erro ao sincronizar tickers: " + ex.Message });
        }
    }

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        try
        {
            var users = await _db.Users
                .OrderBy(u => u.Id)
                .Select(u => new { id = u.Id, username = u.Username, fullname = u.Fullname, email = u.Email })
                .ToListAsync();
            return Ok(users);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar usuários." });
        }
    }

    private async Task<(string source, int inserted, int updated, int skipped, int total)> FetchAndSyncAssetDividends(int assetId, string ticker)
    {
        var dividends = new List<(string? comDate, string? paymentDate, double grossAmount, string type)>();
        string source = "";
        var client = _httpFactory.CreateClient();
        client.DefaultRequestHeaders.Add("User-Agent", YahooUA);

        // 1) InvistaInfo (FIIs)
        if (!dividends.Any())
        {
            try
            {
                var url = $"https://invistainfo.com.br/ativo.php?fii={Uri.EscapeDataString(ticker)}";
                var res = await client.GetAsync(url);
                if (res.IsSuccessStatusCode)
                {
                    var html = await res.Content.ReadAsStringAsync();
                    var tables = Regex.Matches(html, @"<table[\s\S]*?</table>", RegexOptions.IgnoreCase);
                    foreach (Match table in tables)
                    {
                        var rows = Regex.Matches(table.Value, @"<tr[^>]*>[\s\S]*?</tr>");
                        bool found = false;
                        foreach (Match row in rows)
                        {
                            var tds = Regex.Matches(row.Value, @"<td[^>]*>(.*?)</td>", RegexOptions.Singleline);
                            if (tds.Count < 3) continue;
                            var cells = tds.Select(t => Regex.Replace(t.Groups[1].Value, @"<[^>]+>", "").Trim()).ToArray();
                            if (!Regex.IsMatch(cells[0], @"\d{2}/\d{2}/\d{4}")) continue;
                            var comDate = ParseBRDate(cells[0]);
                            var payDate = ParseBRDate(cells[1]);
                            if (double.TryParse(cells[2].Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && comDate != null && value > 0)
                            {
                                dividends.Add((comDate, payDate, value, "rendimento"));
                                found = true;
                            }
                        }
                        if (found) { source = "InvistaInfo"; break; }
                    }
                }
            }
            catch { }
        }

        // 2) Fundamentus
        if (!dividends.Any())
        {
            foreach (var path in new[] { "fii_proventos", "proventos" })
            {
                var isFii = path == "fii_proventos";
                try
                {
                    var url = $"https://fundamentus.com.br/{path}.php?papel={Uri.EscapeDataString(ticker)}";
                    var res = await client.GetAsync(url);
                    if (!res.IsSuccessStatusCode) continue;
                    var html = await res.Content.ReadAsStringAsync();
                    var rows = Regex.Matches(html, @"<tr[^>]*>[\s\S]*?</tr>");
                    bool found = false;
                    foreach (Match row in rows)
                    {
                        var tds = Regex.Matches(row.Value, @"<td[^>]*>(.*?)</td>", RegexOptions.Singleline);
                        if (tds.Count < 4) continue;
                        var cells = tds.Select(t => Regex.Replace(t.Groups[1].Value, @"<[^>]+>", "").Trim()).ToArray();
                        if (!Regex.IsMatch(cells[0], @"\d{2}/\d{2}/\d{4}")) continue;

                        if (isFii)
                        {
                            var comDate = ParseBRDate(cells[0]);
                            var type = cells[1].ToLower().Contains("amortiz") ? "amortizacao" : "rendimento";
                            var payDate = ParseBRDate(cells[2]);
                            if (double.TryParse(cells[3].Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && comDate != null && value > 0)
                            {
                                dividends.Add((comDate, payDate, value, type));
                                found = true;
                            }
                        }
                        else
                        {
                            var comDate = ParseBRDate(cells[0]);
                            if (double.TryParse(cells[1].Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                            {
                                var payDate = ParseBRDate(cells[3]);
                                var type = cells[2].ToLower().Contains("jrs") ? "juros" : "rendimento";
                                if (comDate != null && value > 0)
                                {
                                    dividends.Add((comDate, payDate, value, type));
                                    found = true;
                                }
                            }
                        }
                    }
                    if (found) { source = "Fundamentus"; break; }
                }
                catch { }
            }
        }

        // 3) StockAnalysis
        if (!dividends.Any())
        {
            try
            {
                var url = $"https://stockanalysis.com/quote/bvmf/{Uri.EscapeDataString(ticker)}/dividend/";
                var res = await client.GetAsync(url);
                if (res.IsSuccessStatusCode)
                {
                    var html = await res.Content.ReadAsStringAsync();
                    var rows = Regex.Matches(html, @"<tr[^>]*>[\s\S]*?</tr>");
                    bool found = false;
                    foreach (Match row in rows)
                    {
                        var tds = Regex.Matches(row.Value, @"<td[^>]*>(.*?)</td>", RegexOptions.Singleline);
                        if (tds.Count < 4) continue;
                        var cells = tds.Select(t => Regex.Replace(t.Groups[1].Value, @"<[^>]+>", "").Trim()).ToArray();
                        if (!Regex.IsMatch(cells[0], @"\w{3}\s+\d{1,2},\s*\d{4}")) continue;
                        var comDate = ParseUSDate(cells[0]);
                        if (double.TryParse(Regex.Replace(cells[1], @"[^\d.,]", "").Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out var amt))
                        {
                            var payDate = ParseUSDate(cells[3]);
                            if (comDate != null && amt > 0)
                            {
                                dividends.Add((comDate, payDate ?? comDate, amt, "rendimento"));
                                found = true;
                            }
                        }
                    }
                    if (found) source = "StockAnalysis";
                }
            }
            catch { }
        }

        if (!dividends.Any()) return (source, 0, 0, 0, 0);

        int inserted = 0, updated = 0, skipped = 0;
        foreach (var d in dividends)
        {
            if (d.comDate == null && d.paymentDate == null) { skipped++; continue; }
            try
            {
                var existing = await _db.AssetDividends.FirstOrDefaultAsync(x =>
                    x.Assetid == assetId && x.Comdate == d.comDate);

                if (existing != null)
                {
                    var payDate = d.paymentDate ?? d.comDate;
                    if (existing.Paymentdate != payDate || existing.Grossamount != d.grossAmount || (existing.Type ?? "rendimento") != d.type)
                    {
                        existing.Paymentdate = payDate;
                        existing.Grossamount = d.grossAmount;
                        existing.Type = d.type;
                        updated++;
                    }
                    else skipped++;
                }
                else
                {
                    _db.AssetDividends.Add(new AssetDividend
                    {
                        Assetid = assetId,
                        Comdate = d.comDate,
                        Paymentdate = d.paymentDate ?? d.comDate,
                        Grossamount = d.grossAmount,
                        Type = d.type
                    });
                    inserted++;
                }
            }
            catch { skipped++; }
        }
        await _db.SaveChangesAsync();
        return (source, inserted, updated, skipped, dividends.Count);
    }

    private async Task RunFixPaymentDates()
    {
        var dividendsWithSameDate = await (from d in _db.AssetDividends
                                           join a in _db.B3Assets on d.Assetid equals a.Id
                                           where d.Paymentdate == d.Comdate
                                           orderby a.Ticker, d.Comdate
                                           select new { d, a.Ticker, a.Assettype })
                                           .ToListAsync();

        var byTicker = dividendsWithSameDate.GroupBy(x => x.Ticker).ToDictionary(
            g => g.Key,
            g => new { rows = g.Select(x => x.d).ToList(), assettype = g.First().Assettype });

        var client = _httpFactory.CreateClient();
        client.DefaultRequestHeaders.Add("User-Agent", YahooUA);

        foreach (var kv in byTicker)
        {
            var ticker = kv.Key;
            var dividends = kv.Value.rows;
            var assettype = kv.Value.assettype;
            int atualizados = 0, ignorados = 0;

            if (assettype == "acao")
            {
                try
                {
                    var url = $"https://statusinvest.com.br/acoes/{ticker.ToLower()}";
                    var res = await client.GetAsync(url);
                    if (res.IsSuccessStatusCode)
                    {
                        var html = await res.Content.ReadAsStringAsync();
                        var rows = Regex.Matches(html, @"<tr[^>]*>[\s\S]*?</tr>");
                        var pgtoMap = new Dictionary<string, string>();
                        foreach (Match row in rows)
                        {
                            var tds = Regex.Matches(row.Value, @"<td[^>]*>(.*?)</td>", RegexOptions.Singleline);
                            if (tds.Count < 4) continue;
                            var comRaw = Regex.Replace(tds[1].Groups[1].Value, @"<[^>]+>", "").Trim();
                            var payRaw = Regex.Replace(tds[2].Groups[1].Value, @"<[^>]+>", "").Trim();
                            var valRaw = Regex.Replace(tds[3].Groups[1].Value, @"<[^>]+>", "").Trim();
                            if (!Regex.IsMatch(comRaw, @"\d{2}/\d{2}/\d{4}")) continue;
                            var val = double.TryParse(valRaw.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
                            if (val <= 0) continue;
                            var comDate = ParseBRDate(comRaw);
                            var payDate = ParseBRDate(payRaw);
                            if (comDate != null && payDate != null && payDate != comDate)
                                pgtoMap[comDate] = payDate;
                        }
                        foreach (var div in dividends)
                        {
                            if (div.Comdate != null && pgtoMap.TryGetValue(div.Comdate, out var novaPgto))
                            {
                                div.Paymentdate = novaPgto;
                                atualizados++;
                            }
                            else ignorados++;
                        }
                    }
                    else ignorados = dividends.Count;
                }
                catch { ignorados = dividends.Count; }
            }
            else
            {
                try
                {
                    var url = $"https://investidor10.com.br/fiis/{ticker.ToLower()}/";
                    var res = await client.GetAsync(url);
                    if (res.IsSuccessStatusCode)
                    {
                        var html = await res.Content.ReadAsStringAsync();
                        var tables = Regex.Matches(html, @"<table[\s\S]*?</table>", RegexOptions.IgnoreCase);
                        var i10Data = new List<(string? comDate, string? paymentDate, double grossAmount)>();

                        foreach (Match table in tables)
                        {
                            var ths = Regex.Matches(table.Value, @"<th[^>]*>(.*?)</th>", RegexOptions.IgnoreCase);
                            if (!ths.Any(t => t.Groups[1].Value.ToLower().Contains("data com"))) continue;
                            var trs = Regex.Matches(table.Value, @"<tr[^>]*>[\s\S]*?</tr>");
                            for (int ri = 1; ri < trs.Count; ri++)
                            {
                                var tds = Regex.Matches(trs[ri].Value, @"<td[^>]*>(.*?)</td>", RegexOptions.Singleline);
                                if (tds.Count < 4) continue;
                                var comRaw = Regex.Replace(tds[1].Groups[1].Value, @"<[^>]+>", "").Trim();
                                var payRaw = Regex.Replace(tds[2].Groups[1].Value, @"<[^>]+>", "").Trim();
                                var valRaw = Regex.Replace(tds[3].Groups[1].Value, @"<[^>]+>", "").Trim();
                                if (!Regex.IsMatch(comRaw, @"\d{2}/\d{2}/\d{4}")) continue;
                                var val = double.TryParse(valRaw.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
                                if (val <= 0) continue;
                                i10Data.Add((ParseBRDate(comRaw), ParseBRDate(payRaw), val));
                            }
                            if (i10Data.Any()) break;
                        }

                        if (!i10Data.Any()) ignorados = dividends.Count;
                        else
                        {
                            foreach (var div in dividends)
                            {
                                var match = i10Data
                                    .Where(d => d.paymentDate != d.comDate && Math.Abs(d.grossAmount - (div.Grossamount ?? 0)) < 0.01)
                                    .OrderBy(d => Math.Abs((DateTime.Parse(d.paymentDate ?? d.comDate ?? DateTime.MinValue.ToString("yyyy-MM-dd")) - DateTime.Parse(div.Comdate ?? DateTime.MinValue.ToString("yyyy-MM-dd"))).TotalDays))
                                    .FirstOrDefault();
                                if (string.IsNullOrEmpty(match.paymentDate) || Math.Abs((DateTime.Parse(match.paymentDate) - DateTime.Parse(div.Comdate ?? DateTime.MinValue.ToString("yyyy-MM-dd"))).TotalDays) > 15)
                                { ignorados++; continue; }
                                div.Paymentdate = match.paymentDate;
                                atualizados++;
                            }
                        }
                    }
                    else ignorados = dividends.Count;
                }
                catch { ignorados = dividends.Count; }
                await Task.Delay(1500);
            }
        }

        await _db.SaveChangesAsync();
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

    private static Dictionary<string, JsonElement> ParseSheetRowsForSync(List<string[]> rows)
    {
        if (!rows.Any()) return new();
        var headers = rows[0].Select(h => h.Trim().ToUpperInvariant()).ToArray();
        var fundosIdx = Array.FindIndex(headers, h => h.Contains("FUNDO") || h == "TICKER" || h == "ATIVO" || h == "AÇÃO" || h == "ACAO");
        var precoIdx = Array.FindIndex(headers, h => h.Contains("PREÇO") || h.Contains("PRECO") || h.Contains("ATUAL"));
        var nomeIdx = Array.FindIndex(headers, h => h == "NOME" || h.Contains("NOME") || h.Contains("NAME"));

        if (fundosIdx < 0 || precoIdx < 0) return new();

        var result = new Dictionary<string, JsonElement>();
        for (int i = 1; i < rows.Count; i++)
        {
            var cols = rows[i];
            var ticker = cols.Length > fundosIdx ? cols[fundosIdx]?.Trim().ToUpper() : null;
            if (string.IsNullOrEmpty(ticker)) continue;

            double price = double.NaN;
            var priceStr = cols.Length > precoIdx ? cols[precoIdx]?.Trim() : null;
            if (!string.IsNullOrEmpty(priceStr))
            {
                priceStr = priceStr.Replace("R$", "").Replace(" ", "");
                if (double.TryParse(priceStr.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var p))
                    price = p;
            }

            var name = (nomeIdx >= 0 && nomeIdx < cols.Length && !string.IsNullOrEmpty(cols[nomeIdx]?.Trim()))
                ? cols[nomeIdx].Trim() : ticker;

            var obj = JsonSerializer.SerializeToElement(new { price = double.IsNaN(price) ? (double?)null : price, name });
            result[ticker] = obj;
        }
        return result;
    }

    private static Dictionary<string, JsonElement> ParseSheetCSVForSync(List<string> lines)
    {
        if (!lines.Any()) return new();
        var headerLine = lines[0];
        char sep = ',';
        foreach (var s in new[] { ',', ';', '\t' })
        {
            if (headerLine.Split(s).Length >= 3) { sep = s; break; }
        }
        var headers = headerLine.Split(sep).Select(h => h.Trim().Trim('"').ToUpperInvariant()).ToArray();
        var fundosIdx = Array.FindIndex(headers, h => h.Contains("FUNDO") || h == "TICKER" || h == "ATIVO");
        var precoIdx = Array.FindIndex(headers, h => h.Contains("PREÇO") || h.Contains("PRECO") || h.Contains("ATUAL"));
        var nomeIdx = Array.FindIndex(headers, h => h == "NOME" || h.Contains("NOME"));

        if (fundosIdx < 0 || precoIdx < 0) return new();

        var result = new Dictionary<string, JsonElement>();
        for (int i = 1; i < lines.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i])) continue;
            var cols = lines[i].Split(sep).Select(c => c.Trim().Trim('"')).ToArray();
            var ticker = cols.Length > fundosIdx ? cols[fundosIdx]?.Trim().ToUpper() : null;
            if (string.IsNullOrEmpty(ticker)) continue;

            double price = double.NaN;
            var priceStr = cols.Length > precoIdx ? cols[precoIdx]?.Trim() : null;
            if (!string.IsNullOrEmpty(priceStr))
            {
                priceStr = priceStr.Replace("R$", "").Replace(" ", "");
                if (double.TryParse(priceStr.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var p))
                    price = p;
            }

            var name = (nomeIdx >= 0 && nomeIdx < cols.Length && !string.IsNullOrEmpty(cols[nomeIdx]?.Trim()))
                ? cols[nomeIdx].Trim() : ticker;

            var obj = JsonSerializer.SerializeToElement(new { price = double.IsNaN(price) ? (double?)null : price, name });
            result[ticker] = obj;
        }
        return result;
    }
}
