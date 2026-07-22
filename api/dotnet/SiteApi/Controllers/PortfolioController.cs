using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SiteApi.Data;
using SiteApi.Models;

namespace SiteApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PortfolioController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;

    public PortfolioController(AppDbContext db, IHttpClientFactory httpFactory, IConfiguration config)
    {
        _db = db;
        _httpFactory = httpFactory;
        _config = config;
    }

    private const string YahooUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    [HttpGet]
    public async Task<IActionResult> GetPortfolio([FromQuery] int userId)
    {
        if (userId <= 0)
            return BadRequest(new { error = "userId é obrigatório." });

        var items = await _db.PortfolioItems
            .Where(p => p.Userid == userId)
            .OrderBy(p => p.Purchasedat).ThenBy(p => p.Id)
            .Select(p => new
            {
                id = p.Id,
                ticker = p.Ticker,
                quantity = p.Quantity,
                purchasePrice = p.Purchaseprice,
                purchasedAt = p.Purchasedat,
                institution = p.Institution,
                movementType = p.Movement_type
            })
            .ToListAsync();

        return Ok(items);
    }

    [HttpGet("dividend-returns")]
    public async Task<IActionResult> DividendReturns([FromQuery] int userId)
    {
        if (userId <= 0)
            return BadRequest(new { error = "userId é obrigatório." });

        var result = await _db.AssetDividends
            .Join(_db.B3Assets, d => d.Assetid, a => a.Id, (d, a) => new { d, a })
            .Where(x => _db.PortfolioItems.Any(p =>
                p.Ticker == x.a.Ticker && p.Userid == userId && p.Purchasedat != null && string.Compare(p.Purchasedat, x.d.Comdate) <= 0))
            .GroupBy(x => new { x.a.Ticker })
            .Select(g => new
            {
                ticker = g.Key.Ticker,
                totalDividends = g.Sum(x =>
                    (x.d.Grossamount ?? 0) *
                    _db.PortfolioItems
                        .Where(p => p.Ticker == x.a.Ticker && p.Userid == userId && p.Purchasedat != null && string.Compare(p.Purchasedat, x.d.Comdate) <= 0)
                        .Sum(p => p.Movement_type == "venda" ? -(double)p.Quantity : (double)p.Quantity)
                )
            })
            .ToListAsync();

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> AddItem([FromBody] PortfolioRequest req)
    {
        if (req.UserId <= 0 || string.IsNullOrWhiteSpace(req.Ticker) || req.PurchaseDate == null)
            return BadRequest(new { error = "userId, ticker, quantidade, preço e data são obrigatórios." });

        var normalizedTicker = req.Ticker.Trim().ToUpper();
        var qty = req.Quantity;
        var price = req.PurchasePrice;
        var purchaseDate = req.PurchaseDate.Trim();
        var inst = req.Institution?.Trim() ?? "";
        var movType = req.MovementType ?? "compra";

        if (qty == 0)
            return BadRequest(new { error = "Quantidade deve ser diferente de zero." });

        if (!Regex.IsMatch(purchaseDate, @"^\d{4}-\d{2}-\d{2}$"))
            return BadRequest(new { error = "Data deve estar no formato YYYY-MM-DD." });

        if (qty > 0 && price > 0)
        {
            var exists = await _db.B3Assets.FirstOrDefaultAsync(a => a.Ticker == normalizedTicker);
            if (exists == null)
            {
                try
                {
                    var yahooTicker = normalizedTicker.Contains('.') ? normalizedTicker : $"{normalizedTicker}.SA";
                    var client = _httpFactory.CreateClient();
                    client.DefaultRequestHeaders.Add("User-Agent", YahooUA);
                    var yRes = await client.GetAsync($"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(yahooTicker)}?interval=1d&range=1d");
                    if (yRes.IsSuccessStatusCode)
                    {
                        var yJson = await yRes.Content.ReadAsStringAsync();
                        var yDoc = JsonDocument.Parse(yJson);
                        var meta = yDoc.RootElement.GetProperty("chart").GetProperty("result")[0].GetProperty("meta");
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

                        _db.B3Assets.Add(new B3Asset
                        {
                            Ticker = normalizedTicker,
                            Name = name,
                            Longname = longName,
                            Assettype = assettype
                        });
                        await _db.SaveChangesAsync();
                    }
                }
                catch { /* Auto-create falhou, continua */ }
            }
        }

        var item = new PortfolioItem
        {
            Userid = req.UserId,
            Ticker = normalizedTicker,
            Quantity = qty,
            Purchaseprice = price,
            Purchasedat = purchaseDate,
            Institution = inst,
            Movement_type = movType
        };
        _db.PortfolioItems.Add(item);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            id = item.Id,
            ticker = item.Ticker,
            quantity = item.Quantity,
            purchasePrice = item.Purchaseprice,
            purchaseDate = item.Purchasedat,
            institution = item.Institution,
            movementType = item.Movement_type
        });
    }

    [HttpPut]
    public async Task<IActionResult> UpdateItem([FromBody] PortfolioUpdateRequest req)
    {
        if (req.Id <= 0 || req.UserId <= 0)
            return BadRequest(new { error = "id e userId são obrigatórios." });

        var item = await _db.PortfolioItems.FirstOrDefaultAsync(p => p.Id == req.Id && p.Userid == req.UserId);
        if (item == null)
            return NotFound(new { error = "Item não encontrado." });

        if (req.Quantity.HasValue)
        {
            if (req.Quantity.Value == 0)
                return BadRequest(new { error = "Quantidade deve ser diferente de zero." });
            item.Quantity = req.Quantity.Value;
        }
        if (req.PurchasePrice.HasValue)
            item.Purchaseprice = req.PurchasePrice.Value;
        if (!string.IsNullOrEmpty(req.PurchaseDate))
        {
            var date = req.PurchaseDate.Trim();
            if (!Regex.IsMatch(date, @"^\d{4}-\d{2}-\d{2}$"))
                return BadRequest(new { error = "Data deve estar no formato YYYY-MM-DD." });
            item.Purchasedat = date;
        }

        await _db.SaveChangesAsync();
        return Ok(new { id = item.Id, quantity = item.Quantity, purchasePrice = item.Purchaseprice, purchaseDate = item.Purchasedat });
    }

    [HttpDelete]
    public async Task<IActionResult> DeleteItem([FromQuery] int userId, [FromQuery] int id)
    {
        if (userId <= 0 || id <= 0)
            return BadRequest(new { error = "userId e id são obrigatórios." });

        var item = await _db.PortfolioItems.FirstOrDefaultAsync(p => p.Id == id && p.Userid == userId);
        if (item != null)
        {
            _db.PortfolioItems.Remove(item);
            await _db.SaveChangesAsync();
        }
        return Ok(new { success = true });
    }

    [HttpDelete("clear")]
    public async Task<IActionResult> ClearPortfolio([FromBody] ClearPortfolioRequest req)
    {
        if (req.UserId <= 0)
            return BadRequest(new { error = "userId é obrigatório." });

        var items = await _db.PortfolioItems.Where(p => p.Userid == req.UserId).ToListAsync();
        _db.PortfolioItems.RemoveRange(items);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpPost("parse-b3-xlsx")]
    public async Task<IActionResult> ParseB3Xlsx([FromBody] ParseXlsxRequest req)
    {
        if (req.UserId <= 0 || string.IsNullOrWhiteSpace(req.FileBase64))
            return BadRequest(new { error = "userId e fileBase64 são obrigatórios." });

        try
        {
            var bytes = Convert.FromBase64String(req.FileBase64);
            using var stream = new MemoryStream(bytes);
            using var wb = new XLWorkbook(stream);
            var sheet = wb.Worksheets.Worksheet("Movimentação");
            if (sheet == null)
                return BadRequest(new { error = "Planilha não contém a aba \"Movimentação\"." });

            var lastRow = sheet.LastRowUsed()?.RowNumber() ?? 1;
            var lastCol = sheet.LastColumnUsed()?.ColumnNumber() ?? 1;
            var assets = new List<object>();
            var positions = new Dictionary<string, (int quantity, double totalCost)>();

            for (int i = 2; i <= lastRow; i++)
            {
                var entry = (sheet.Cell(i, 1).GetString() ?? "").Trim();
                var dateRaw = (sheet.Cell(i, 2).GetString() ?? "").Trim();
                var mov = (sheet.Cell(i, 3).GetString() ?? "").Trim();
                var prod = (sheet.Cell(i, 4).GetString() ?? "").Trim();
                var inst = (sheet.Cell(i, 5).GetString() ?? "").Trim();
                var qty = (int)(sheet.Cell(i, 6).GetDouble());
                var priceStr = (sheet.Cell(i, 7).GetString() ?? "0").Replace(',', '.');
                double.TryParse(priceStr, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var price);
                var ticker = prod.Split(" - ")[0].Trim();

                if (string.IsNullOrEmpty(ticker) || ticker.Length < 4 || ticker == "-" || qty <= 0) continue;

                if (!positions.ContainsKey(ticker))
                    positions[ticker] = (0, 0);
                var p = positions[ticker];
                var date = !string.IsNullOrEmpty(dateRaw) ? dateRaw.Split('/').Reverse().Aggregate((a, b) => $"{a}-{b}") : DateTime.UtcNow.ToString("yyyy-MM-dd");

                if (mov == "Transferência - Liquidação" && entry == "Credito")
                {
                    assets.Add(new { ticker, quantity = qty, purchasePrice = price, purchaseDate = date, institution = inst, movementType = "compra" });
                    p.quantity += qty;
                    p.totalCost += qty * price;
                }
                else if (mov == "Transferência - Liquidação" && entry == "Debito")
                {
                    var avgPrice = p.quantity > 0 ? Math.Round(p.totalCost / p.quantity, 2) : 0;
                    assets.Add(new { ticker, quantity = -qty, purchasePrice = avgPrice, purchaseDate = date, institution = inst, movementType = "venda" });
                    p.quantity -= qty;
                    p.totalCost -= qty * avgPrice;
                }
                else if (mov == "Transferência" && entry == "Debito")
                {
                    assets.Add(new { ticker, quantity = -qty, purchasePrice = 0, purchaseDate = date, institution = inst, movementType = "venda" });
                    if (p.quantity > 0) p.quantity -= qty;
                }
                else if (mov == "Bonificação em Ativos" && entry == "Credito")
                {
                    assets.Add(new { ticker, quantity = qty, purchasePrice = 0, purchaseDate = date, institution = inst, movementType = "bonificacao" });
                    p.quantity += qty;
                }
                else if (mov == "Desdobro" && entry == "Credito")
                {
                    assets.Add(new { ticker, quantity = qty, purchasePrice = 0, purchaseDate = date, institution = inst, movementType = "desdobro" });
                    p.quantity += qty;
                }
                else if (mov == "Grupamento" && entry == "Credito")
                {
                    assets.Add(new { ticker, quantity = qty, purchasePrice = 0, purchaseDate = date, institution = inst, movementType = "grupamento" });
                    p.quantity += qty;
                }
                else if (mov == "Incorporação" && entry == "Credito")
                {
                    assets.Add(new { ticker, quantity = qty, purchasePrice = 0, purchaseDate = date, institution = inst, movementType = "incorporacao" });
                    p.quantity += qty;
                }
                else if (mov == "Fração em Ativos" && entry == "Debito")
                {
                    assets.Add(new { ticker, quantity = -qty, purchasePrice = 0, purchaseDate = date, institution = inst, movementType = "fracao" });
                    if (p.quantity > 0) p.quantity -= qty;
                }
                else if (mov == "Leilão de Fração" && entry == "Credito")
                {
                    assets.Add(new { ticker, quantity = qty, purchasePrice = price, purchaseDate = date, institution = inst, movementType = "leilao" });
                    p.quantity += qty;
                    p.totalCost += qty * price;
                }

                positions[ticker] = p;
            }

            var sorted = assets.OrderBy(a =>
            {
                var prop = a.GetType().GetProperty("purchaseDate");
                return prop?.GetValue(a)?.ToString() ?? "";
            }).ThenBy(a =>
            {
                var prop = a.GetType().GetProperty("ticker");
                return prop?.GetValue(a)?.ToString() ?? "";
            }).ToList();

            return Ok(new { assets = sorted });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Erro ao processar arquivo: " + ex.Message, assets = Array.Empty<object>() });
        }
    }
}
