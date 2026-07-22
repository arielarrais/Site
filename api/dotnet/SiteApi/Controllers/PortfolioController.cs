using Microsoft.AspNetCore.Mvc;
using SiteApi.Application.DTOs.Portfolio;
using SiteApi.Application.Interfaces;

namespace SiteApi.Presentation.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PortfolioController : ControllerBase
{
    private readonly IPortfolioService _portfolioService;

    public PortfolioController(IPortfolioService portfolioService) => _portfolioService = portfolioService;

    [HttpGet]
    public async Task<IActionResult> GetPortfolio([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest(new { error = "userId é obrigatório." });
        var items = await _portfolioService.GetByUserIdAsync(userId);
        return Ok(items);
    }

    [HttpGet("dividend-returns")]
    public async Task<IActionResult> DividendReturns([FromQuery] int userId)
    {
        if (userId <= 0) return BadRequest(new { error = "userId é obrigatório." });
        var result = await _portfolioService.GetDividendReturnsAsync(userId);
        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> AddItem([FromBody] CreatePortfolioItemRequest req)
    {
        try
        {
            var result = await _portfolioService.AddAsync(req);
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
        try
        {
            var result = await _portfolioService.UpdateAsync(req);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete]
    public async Task<IActionResult> DeleteItem([FromQuery] int userId, [FromQuery] int id)
    {
        if (userId <= 0 || id <= 0) return BadRequest(new { error = "userId e id são obrigatórios." });
        await _portfolioService.DeleteAsync(userId, id);
        return Ok(new { success = true });
    }

    [HttpDelete("clear")]
    public async Task<IActionResult> ClearPortfolio([FromBody] ClearPortfolioRequest req)
    {
        if (req.UserId <= 0) return BadRequest(new { error = "userId é obrigatório." });
        await _portfolioService.ClearAsync(req.UserId);
        return Ok(new { success = true });
    }
}

public record ClearPortfolioRequest(int UserId);
