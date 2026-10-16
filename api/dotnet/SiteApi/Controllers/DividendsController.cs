using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SiteApi.Application.DTOs.Dividends;
using SiteApi.Application.Interfaces;

namespace SiteApi.Presentation.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class DividendsController : SecureApiController
{
    private readonly IDividendService _dividendService;

    public DividendsController(IDividendService dividendService) => _dividendService = dividendService;

    [HttpGet]
    public async Task<IActionResult> GetDividends([FromQuery] int? assetId, [FromQuery] string? ticker)
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });

        try
        {
            if (!string.IsNullOrEmpty(ticker))
                return Ok(await _dividendService.GetByTickerAsync(ticker));
            if (assetId.HasValue && assetId.Value > 0)
                return Ok(await _dividendService.GetByAssetIdAsync(assetId.Value));
            return Ok(await _dividendService.GetByUserIdAsync(userId));
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar dividendos." });
        }
    }

    [HttpGet("monthly")]
    public async Task<IActionResult> GetMonthlyDividends()
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });
        try
        {
            var result = await _dividendService.GetMonthlyAsync(userId);
            return Ok(result);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar dividendos mensais." });
        }
    }

    [HttpGet("calendar")]
    public async Task<IActionResult> GetDividendCalendar([FromQuery] int? year)
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });
        var target = year is >= 1990 and <= 2100 ? year.Value : DateTime.Now.Year;
        try
        {
            return Ok(await _dividendService.GetCalendarAsync(userId, target));
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar o calendário de dividendos." });
        }
    }

    [HttpPost]
    public async Task<IActionResult> CreateDividend([FromBody] CreateDividendRequest req)
    {
        try
        {
            var result = await _dividendService.CreateAsync(req);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}