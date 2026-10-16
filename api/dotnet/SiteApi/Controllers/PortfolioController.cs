using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SiteApi.Application.DTOs.Portfolio;
using SiteApi.Application.Interfaces;

namespace SiteApi.Presentation.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class PortfolioController : SecureApiController
{
    private readonly IPortfolioService _portfolioService;

    public PortfolioController(IPortfolioService portfolioService) => _portfolioService = portfolioService;

    [HttpGet]
    public async Task<IActionResult> GetPortfolio()
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });
        var items = await _portfolioService.GetByUserIdAsync(userId);
        return Ok(items);
    }

    [HttpGet("dividend-returns")]
    public async Task<IActionResult> DividendReturns()
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });
        var result = await _portfolioService.GetDividendReturnsAsync(userId);
        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> AddItem([FromBody] CreatePortfolioItemRequest req)
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });

        try
        {
            var result = await _portfolioService.AddAsync(req with { UserId = userId });
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut]
    public async Task<IActionResult> UpdateItem([FromBody] UpdatePortfolioItemRequest req)
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });

        try
        {
            var result = await _portfolioService.UpdateAsync(req with { UserId = userId });
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete]
    public async Task<IActionResult> DeleteItem([FromQuery] int id)
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });
        if (id <= 0) return BadRequest(new { error = "id é obrigatório." });
        await _portfolioService.DeleteAsync(userId, id);
        return Ok(new { success = true });
    }

    [HttpDelete("clear")]
    public async Task<IActionResult> ClearPortfolio()
    {
        if (!TryGetCurrentUserId(out var userId)) return Unauthorized(new { error = "Sessao invalida." });
        await _portfolioService.ClearAsync(userId);
        return Ok(new { success = true });
    }
}