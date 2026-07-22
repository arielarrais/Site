using Microsoft.AspNetCore.Mvc;
using SiteApi.Application.DTOs.Dividends;
using SiteApi.Application.Interfaces;

namespace SiteApi.Presentation.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DividendsController : ControllerBase
{
    private readonly IDividendService _dividendService;

    public DividendsController(IDividendService dividendService) => _dividendService = dividendService;

    [HttpGet]
    public async Task<IActionResult> GetDividends([FromQuery] int? assetId, [FromQuery] string? ticker, [FromQuery] int? userId)
    {
        try
        {
            if (!string.IsNullOrEmpty(ticker))
                return Ok(await _dividendService.GetByTickerAsync(ticker));
            if (assetId.HasValue && assetId.Value > 0)
                return Ok(await _dividendService.GetByAssetIdAsync(assetId.Value));
            if (userId.HasValue && userId.Value > 0)
                return Ok(await _dividendService.GetByUserIdAsync(userId.Value));
            return Ok(new List<DividendDto>());
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar dividendos." });
        }
    }

    [HttpGet("monthly")]
    public async Task<IActionResult> GetMonthlyDividends([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest(new { error = "userId é obrigatório." });
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
