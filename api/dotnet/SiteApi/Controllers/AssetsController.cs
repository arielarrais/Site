using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SiteApi.Application.Interfaces;

namespace SiteApi.Presentation.Controllers;

[ApiController]
public class AssetsController : ControllerBase
{
    private readonly IAssetService _assetService;

    public AssetsController(IAssetService assetService) => _assetService = assetService;

    [HttpGet("~/api/b3-assets")]
    public async Task<IActionResult> SearchAssets([FromQuery] string? q)
    {
        var items = await _assetService.SearchAsync(q);
        return Ok(items.Select(a => new { id = a.Id, ticker = a.Ticker, name = a.Name, assettype = a.AssetType, regularmarketprice = a.RegularMarketPrice }));
    }

    [HttpGet("~/api/assets/types")]
    public async Task<IActionResult> GetAssetTypes([FromQuery] string? tickers)
    {
        var tickerList = (tickers ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim().ToUpper()).Where(t => !string.IsNullOrEmpty(t)).ToList();
        var result = await _assetService.GetAssetTypesAsync(tickerList);
        return Ok(result);
    }

    [HttpPost("~/api/assets/auto-create")]
    [Authorize]
    public async Task<IActionResult> AutoCreate([FromBody] AutoCreateRequest req)
    {
        try
        {
            var result = await _assetService.AutoCreateAsync(req.Ticker);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

public record AutoCreateRequest(string Ticker);
