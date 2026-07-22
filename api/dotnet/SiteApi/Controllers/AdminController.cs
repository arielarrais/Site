using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SiteApi.Application.DTOs.Dividends;
using SiteApi.Application.Interfaces;
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

    public AdminController(
        IAssetRepository assetRepository,
        IDividendRepository dividendRepository,
        IUserRepository userRepository,
        IDividendFetchingService dividendFetchingService)
    {
        _assetRepository = assetRepository;
        _dividendRepository = dividendRepository;
        _userRepository = userRepository;
        _dividendFetchingService = dividendFetchingService;
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
        _ = Task.Run(async () =>
        {
            foreach (var a in assets)
            {
                try { await _dividendFetchingService.FetchAndSyncAssetDividendsAsync(a.Id, a.Ticker); }
                catch { }
            }
        });
        return Ok(new { total = assets.Count, message = "Sincronização iniciada em segundo plano." });
    }

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
