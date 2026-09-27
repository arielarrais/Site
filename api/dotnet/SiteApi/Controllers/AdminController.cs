using System.Net.Http;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SiteApi.Application.DTOs.Dividends;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;
using SiteApi.Domain.Interfaces.Services;
using SiteApi.Infrastructure.Data;

namespace SiteApi.Presentation.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AdminController : ControllerBase
{
    private readonly IAssetRepository _assetRepository;
    private readonly IDividendRepository _dividendRepository;
    private readonly IUserRepository _userRepository;
    private readonly IDividendFetchingService _dividendFetchingService;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly AppDbContext _db;
    private readonly IServiceScopeFactory _scopeFactory;

    public AdminController(
        IAssetRepository assetRepository,
        IDividendRepository dividendRepository,
        IUserRepository userRepository,
        IDividendFetchingService dividendFetchingService,
        IHttpClientFactory httpFactory,
        IConfiguration config,
        AppDbContext db,
        IServiceScopeFactory scopeFactory)
    {
        _assetRepository = assetRepository;
        _dividendRepository = dividendRepository;
        _userRepository = userRepository;
        _dividendFetchingService = dividendFetchingService;
        _httpFactory = httpFactory;
        _config = config;
        _db = db;
        _scopeFactory = scopeFactory;
    }

    [HttpGet("assets")]
    public async Task<IActionResult> GetAdminAssets()
    {
        try
        {
            var assets = await _assetRepository.GetAllAsync();
            var result = assets.Select(a => new
            {
                id = a.Id,
                ticker = a.Ticker,
                name = a.Name,
                assettype = a.AssetType,
                fiitype = a.FiiType,
                lastcomdate = _dividendRepository.GetByAssetIdAsync(a.Id).Result.FirstOrDefault()?.ComDate,
                lastdividenddate = _dividendRepository.GetByAssetIdAsync(a.Id).Result.FirstOrDefault()?.PaymentDate,
                lastdividendvalue = _dividendRepository.GetByAssetIdAsync(a.Id).Result.FirstOrDefault()?.GrossAmount
            }).OrderBy(a => a.assettype).ThenBy(a => a.ticker).ToList();
            return Ok(result);
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
            var dividends = assetId.HasValue
                ? await _dividendRepository.GetByAssetIdAsync(assetId.Value)
                : await _dividendRepository.GetAllAsync();

            var result = dividends.Select(d => new
            {
                id = d.Id, assetid = d.AssetId, paymentdate = d.PaymentDate,
                grossamount = d.GrossAmount, netamount = d.NetAmount,
                description = d.Description, type = d.Type, createdat = d.CreatedAt
            });
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

        var dividend = new SiteApi.Domain.Entities.AssetDividend
        {
            AssetId = req.AssetId,
            ComDate = req.ComDate,
            PaymentDate = req.PaymentDate,
            GrossAmount = req.GrossAmount,
            Type = req.Type ?? "dividendo"
        };
        await _dividendRepository.AddAsync(dividend);
        return Ok(new { id = dividend.Id, assetId = dividend.AssetId, comDate = dividend.ComDate, paymentDate = dividend.PaymentDate, grossAmount = dividend.GrossAmount, type = dividend.Type });
    }

    [HttpPost("fetch-dividends")]
    public async Task<IActionResult> FetchDividends([FromBody] FetchDividendsRequest req)
    {
        var ticker = (req.Ticker ?? "").Trim().ToUpper();
        if (string.IsNullOrEmpty(ticker)) return BadRequest(new { error = "Ticker é obrigatório." });
        var asset = await _assetRepository.GetByTickerAsync(ticker);
        if (asset == null) return NotFound(new { error = "Ativo não encontrado." });
        var result = await _dividendFetchingService.FetchAndSyncAssetDividendsAsync(asset.Id, ticker);
        return Ok(new { ticker, result });
    }

    [HttpPost("fetch-all-dividends")]
    public async Task<IActionResult> FetchAllDividends()
    {
        var assets = await _assetRepository.GetAllAsync();
        var scopeFactory = _scopeFactory;

        DividendSyncStatus.Reset(assets.Count);
        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<IDividendFetchingService>();

            foreach (var a in assets)
            {
                try
                {
                    var r = await service.FetchAndSyncAssetDividendsAsync(a.Id, a.Ticker);
                    DividendSyncStatus.Processed(a.Ticker, r.Source, r.Inserted, r.Updated, r.Skipped);
                }
                catch
                {
                    DividendSyncStatus.Processed(a.Ticker, "erro", 0, 0, 0);
                }
            }

            DividendSyncStatus.Finish();
        });

        return Ok(new { total = assets.Count, message = "Sincronização iniciada em segundo plano." });
    }

    [HttpGet("fetch-all-dividends-status")]
    public IActionResult FetchAllDividendsStatus()
    {
        return Ok(new
        {
            running = DividendSyncStatus.Running,
            total = DividendSyncStatus.Total,
            processed = DividendSyncStatus.ProcessedCount,
            inserted = DividendSyncStatus.Inserted,
            updated = DividendSyncStatus.Updated,
            skipped = DividendSyncStatus.Skipped,
            errors = DividendSyncStatus.Errors,
            finished = DividendSyncStatus.Finished,
            lastTicker = DividendSyncStatus.LastTicker
        });
    }

    [HttpPost("import-tickers")]
    public async Task<IActionResult> ImportTickers()
    {
        try
        {
            var token = _config["BrapiToken"] ?? "";
            var client = _httpFactory.CreateClient();
            var rows = new List<(string Ticker, string Name, string AssetType, string FiiType, string? Sector, string? Price, string? Logo)>();

            foreach (var type in new[] { "stock", "fund" })
            {
                var url = $"https://brapi.dev/api/quote/list?type={type}";
                if (!string.IsNullOrEmpty(token)) url += $"&token={Uri.EscapeDataString(token)}";

                var response = await client.GetAsync(url);
                response.EnsureSuccessStatusCode();
                var json = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("stocks", out var stocks)) continue;

                foreach (var item in stocks.EnumerateArray())
                {
                    var ticker = item.TryGetProperty("stock", out var st) ? st.GetString() ?? "" : "";
                    if (string.IsNullOrWhiteSpace(ticker)) continue;

                    var name = item.TryGetProperty("name", out var nm) ? nm.GetString() ?? ticker : ticker;
                    var itemType = item.TryGetProperty("type", out var tp) ? tp.GetString() ?? "" : "";
                    var subType = item.TryGetProperty("subType", out var sp) && sp.ValueKind != JsonValueKind.Null
                        ? sp.GetString() ?? "" : "";
                    var sector = item.TryGetProperty("sector", out var sc) && sc.ValueKind != JsonValueKind.Null
                        ? sc.GetString() : null;
                    var logo = item.TryGetProperty("logo", out var lg) && lg.ValueKind != JsonValueKind.Null
                        ? lg.GetString() : null;
                    var price = item.TryGetProperty("close", out var cl) && cl.ValueKind != JsonValueKind.Null
                        ? cl.GetDouble().ToString("F2") : null;

                    string? assetType = null;
                    string? fiiType = null;

                    if (itemType == "stock")
                    {
                        assetType = "acao";
                        fiiType = string.IsNullOrEmpty(subType) ? "acao" : subType;
                    }
                    else if (itemType == "fund")
                    {
                        var isFii = subType is "fii" or "fi-infra" or "fi-agro" ||
                                    (string.IsNullOrEmpty(subType) && IsFiiTicker(ticker));
                        if (isFii)
                        {
                            assetType = "fii";
                            fiiType = string.IsNullOrEmpty(subType) ? "fii" : subType;
                        }
                    }

                    if (assetType == null) continue;
                    rows.Add((ticker.ToUpper(), name, assetType!, fiiType!, sector, price, logo));
                }
            }

            var existing = await _assetRepository.GetByTickersAsync(rows.Select(r => r.Ticker).ToList());
            var existingMap = existing.ToDictionary(a => a.Ticker, a => a);
            var createdAt = DateTime.UtcNow.ToString("yyyy-MM-dd");

            int inserted = 0, updated = 0;
            foreach (var row in rows)
            {
                if (existingMap.TryGetValue(row.Ticker, out var asset))
                {
                    asset.Name = row.Name;
                    asset.AssetType = row.AssetType;
                    asset.FiiType = row.FiiType;
                    asset.Sector = row.Sector;
                    asset.RegularMarketPrice = row.Price;
                    asset.LogoUrl = row.Logo;
                    updated++;
                }
                else
                {
                    _db.B3Assets.Add(new B3Asset
                    {
                        Ticker = row.Ticker,
                        Name = row.Name,
                        AssetType = row.AssetType,
                        FiiType = row.FiiType,
                        Sector = row.Sector,
                        RegularMarketPrice = row.Price,
                        LogoUrl = row.Logo,
                        LongName = row.Name,
                        CreatedAt = createdAt
                    });
                    inserted++;
                }
            }

            await _db.SaveChangesAsync();

            var acoes = rows.Count(r => r.AssetType == "acao");
            var fiis = rows.Count(r => r.AssetType == "fii");
            return Ok(new { total = rows.Count, inserted, updated, acoes, fiis, message = $"Importação concluída: {inserted} inseridos, {updated} atualizados." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Erro ao importar tickers: " + ex.Message });
        }
    }

    private static bool IsFiiTicker(string ticker) =>
        ticker.Length is 5 or 6 && ticker.EndsWith("11");

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        try
        {
            var users = await _userRepository.GetAllAsync();
            return Ok(users.Select(u => new { id = u.Id, username = u.Username, fullname = u.Fullname, email = u.Email }));
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar usuários." });
        }
    }
}

public record FetchDividendsRequest(string Ticker);

public static class DividendSyncStatus
{
    public static bool Running { get; private set; }
    public static bool Finished { get; private set; }
    public static int Total { get; private set; }
    public static int ProcessedCount { get; private set; }
    public static int Inserted { get; private set; }
    public static int Updated { get; private set; }
    public static int Skipped { get; private set; }
    public static int Errors { get; private set; }
    public static string LastTicker { get; private set; } = "";

    private static readonly object _lock = new();

    public static void Reset(int total)
    {
        lock (_lock)
        {
            Running = true;
            Finished = false;
            Total = total;
            ProcessedCount = 0;
            Inserted = 0;
            Updated = 0;
            Skipped = 0;
            Errors = 0;
            LastTicker = "";
        }
    }

    public static void Processed(string ticker, string source, int inserted, int updated, int skipped)
    {
        lock (_lock)
        {
            ProcessedCount++;
            Inserted += inserted;
            Updated += updated;
            Skipped += skipped;
            if (source == "erro") Errors++;
            LastTicker = $"{ticker} ({source})";
        }
    }

    public static void Finish()
    {
        lock (_lock)
        {
            Running = false;
            Finished = true;
        }
    }
}
