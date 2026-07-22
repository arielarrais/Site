using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SiteApi.Data;
using SiteApi.Models;

namespace SiteApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AssetsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _httpFactory;

    public AssetsController(AppDbContext db, IHttpClientFactory httpFactory)
    {
        _db = db;
        _httpFactory = httpFactory;
    }

    private const string YahooUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    [HttpGet("~/api/b3-assets")]
    public async Task<IActionResult> SearchAssets([FromQuery] string? q)
    {
        var query = (q ?? "").Trim().ToUpper();
        try
        {
            if (!string.IsNullOrEmpty(query))
            {
                var items = await _db.B3Assets
                    .Where(a => a.Ticker.Contains(query) || (a.Name != null && a.Name.Contains(query)))
                    .OrderBy(a => a.Ticker)
                    .Take(30)
                    .Select(a => new { id = a.Id, ticker = a.Ticker, name = a.Name, assettype = a.Assettype, regularmarketprice = a.Regularmarketprice })
                    .ToListAsync();
                return Ok(items);
            }
            else
            {
                var items = await _db.B3Assets
                    .OrderBy(a => a.Assettype).ThenBy(a => a.Ticker)
                    .Select(a => new { id = a.Id, ticker = a.Ticker, name = a.Name, assettype = a.Assettype, regularmarketprice = a.Regularmarketprice })
                    .ToListAsync();
                return Ok(items);
            }
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Erro ao buscar ativos B3." });
        }
    }

    [HttpGet("~/api/assets/types")]
    public async Task<IActionResult> GetAssetTypes([FromQuery] string? tickers)
    {
        var tickerList = (tickers ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim().ToUpper())
            .Where(t => !string.IsNullOrEmpty(t))
            .ToList();

        if (!tickerList.Any())
            return Ok(new Dictionary<string, string>());

        try
        {
            var existing = await _db.B3Assets
                .Where(a => tickerList.Contains(a.Ticker))
                .Select(a => new { a.Ticker, a.Assettype })
                .ToListAsync();

            var map = existing.ToDictionary(a => a.Ticker, a => a.Assettype ?? "acao");
            var missing = tickerList.Where(t => !map.ContainsKey(t)).ToList();

            if (missing.Any())
            {
                var client = _httpFactory.CreateClient();
                client.DefaultRequestHeaders.Add("User-Agent", YahooUA);

                foreach (var t in missing)
                {
                    try
                    {
                        var yahooTicker = t.Contains('.') ? t : $"{t}.SA";
                        var yRes = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?interval=1d&range=1d");
                        if (!yRes.IsSuccessStatusCode) continue;
                        var yJson = await yRes.Content.ReadAsStringAsync();
                        var yDoc = JsonDocument.Parse(yJson);
                        var meta = yDoc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");

                        var name = (meta.TryGetProperty("shortName", out var sn) ? sn.GetString() : null)
                                   ?? (meta.TryGetProperty("symbol", out var sy) ? sy.GetString() : null)
                                   ?? t;
                        name = name.Length > 255 ? name[..255] : name;
                        string? longName = null;
                        if (meta.TryGetProperty("longName", out var ln))
                        {
                            longName = ln.GetString();
                            if (longName?.Length > 255) longName = longName[..255];
                        }

                        var assettype = "acao";
                        if (t.EndsWith("11")) assettype = "fii";
                        else if (meta.TryGetProperty("instrumentType", out var it) &&
                                 (it.GetString() == "ETF" || it.GetString() == "FUND"))
                            assettype = "fii";

                        _db.B3Assets.Add(new B3Asset { Ticker = t, Name = name, Longname = longName, Assettype = assettype });
                        await _db.SaveChangesAsync();
                        map[t] = assettype;
                    }
                    catch
                    {
                        if (t.EndsWith("11")) map[t] = "fii";
                    }
                }
            }

            return Ok(map);
        }
        catch
        {
            return Ok(new Dictionary<string, string>());
        }
    }

    [HttpPost("~/api/b3-assets")]
    [Authorize]
    public async Task<IActionResult> CreateAsset([FromBody] CreateAssetRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Ticker) || string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { error = "Ticker e nome são obrigatórios." });

        var normalizedTicker = req.Ticker.Trim().ToUpper();
        try
        {
            var asset = new B3Asset
            {
                Ticker = normalizedTicker,
                Name = req.Name.Trim(),
                Assettype = req.AssetType?.Trim()
            };
            _db.B3Assets.Add(asset);
            await _db.SaveChangesAsync();

            return Ok(new { id = asset.Id, ticker = asset.Ticker, name = asset.Name, assetType = asset.Assettype });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Erro ao salvar ativo B3." });
        }
    }

    [HttpPost("~/api/assets/auto-create")]
    [Authorize]
    public async Task<IActionResult> AutoCreate([FromBody] AutoCreateRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Ticker))
            return BadRequest(new { error = "Ticker é obrigatório." });

        var normalizedTicker = req.Ticker.Trim().ToUpper();

        try
        {
            var existing = await _db.B3Assets.FirstOrDefaultAsync(a => a.Ticker == normalizedTicker);
            if (existing != null)
                return Ok(new { id = existing.Id, ticker = existing.Ticker, name = existing.Name, assetType = existing.Assettype, alreadyExisted = true });

            var yahooTicker = normalizedTicker.Contains('.') ? normalizedTicker : $"{normalizedTicker}.SA";
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Add("User-Agent", YahooUA);

            var chartRes = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?interval=1d&range=1d");
            if (!chartRes.IsSuccessStatusCode)
                return NotFound(new { error = "Ativo não encontrado no Yahoo Finance." });

            var chartJson = await chartRes.Content.ReadAsStringAsync();
            var chartDoc = JsonDocument.Parse(chartJson);
            var meta = chartDoc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");

            var name = (meta.TryGetProperty("shortName", out var sn) ? sn.GetString() : null)
                       ?? (meta.TryGetProperty("symbol", out var sy) ? sy.GetString() : null)
                       ?? normalizedTicker;
            name = name.Length > 255 ? name[..255] : name;
            string? longName = null;
            if (meta.TryGetProperty("longName", out var ln))
            {
                longName = ln.GetString();
                if (longName?.Length > 255) longName = longName[..255];
            }

            var assettype = "acao";
            if (normalizedTicker.EndsWith("11")) assettype = "fii";
            else if (meta.TryGetProperty("instrumentType", out var it) &&
                     (it.GetString() == "ETF" || it.GetString() == "FUND"))
                assettype = "fii";

            var asset = new B3Asset { Ticker = normalizedTicker, Name = name, Longname = longName, Assettype = assettype };
            _db.B3Assets.Add(asset);
            await _db.SaveChangesAsync();

            var dividendsInserted = 0;
            try
            {
                var divRes = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?range=5y&interval=1d&events=div");
                if (divRes.IsSuccessStatusCode)
                {
                    var divJson = await divRes.Content.ReadAsStringAsync();
                    var divDoc = JsonDocument.Parse(divJson);
                    var divResult = divDoc.RootElement.GetProperty("chart").GetProperty("result")[0];
                    if (divResult.TryGetProperty("events", out var events) && events.TryGetProperty("dividends", out var dividends))
                    {
                        foreach (var divProp in dividends.EnumerateObject())
                        {
                            if (!long.TryParse(divProp.Name, out var ts)) continue;
                            var dateStr = DateTimeOffset.FromUnixTimeSeconds(ts).UtcDateTime.ToString("yyyy-MM-dd");
                            var amount = divProp.Value.TryGetProperty("amount", out var amtProp) ? amtProp.GetDouble() : 0;
                            if (amount <= 0) continue;

                            var dup = await _db.AssetDividends.FirstOrDefaultAsync(d =>
                                d.Assetid == asset.Id && d.Grossamount == amount &&
                                d.Comdate != null && d.Comdate.Length >= 7 && d.Comdate.Substring(0, 7) == dateStr.Substring(0, 7));

                            if (dup == null)
                            {
                                _db.AssetDividends.Add(new AssetDividend
                                {
                                    Assetid = asset.Id,
                                    Comdate = dateStr,
                                    Grossamount = amount,
                                    Netamount = amount,
                                    Description = "Dividendo",
                                    Type = "dividendo"
                                });
                                dividendsInserted++;
                            }
                        }
                        await _db.SaveChangesAsync();
                    }
                }
            }
            catch { /* Erro ao buscar dividendos, ignora */ }

            return Ok(new { id = asset.Id, ticker = asset.Ticker, name = asset.Name, assetType = asset.Assettype, dividendsInserted });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Erro ao criar ativo automaticamente." });
        }
    }
}
