using Microsoft.AspNetCore.Mvc;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Presentation.Controllers;

[ApiController]
public class QuotesController : ControllerBase
{
    private readonly IQuoteAppService _quoteAppService;

    public QuotesController(IQuoteAppService quoteAppService) => _quoteAppService = quoteAppService;

    [HttpGet("~/api/quote")]
    public async Task<IActionResult> GetQuote([FromQuery] string? ticker)
    {
        if (string.IsNullOrEmpty(ticker)) return BadRequest(new { error = "Ticker é obrigatório." });
        var result = await _quoteAppService.GetQuoteAsync(ticker.Trim().ToUpper());
        if (result == null) return NotFound(new { error = "Preço não encontrado." });
        return Ok(result);
    }

    [HttpGet("~/api/quotes")]
    public async Task<IActionResult> GetQuotes([FromQuery] string? tickers)
    {
        var tickerList = (tickers ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim().ToUpper()).ToList();
        if (!tickerList.Any()) return BadRequest(new { error = "Tickers são obrigatórios." });
        var result = await _quoteAppService.GetQuotesAsync(tickerList);
        return Ok(result);
    }

    [HttpGet("~/api/quote/yahoo")]
    public async Task<IActionResult> GetYahooQuote([FromQuery] string? ticker)
    {
        if (string.IsNullOrEmpty(ticker)) return BadRequest(new { error = "Ticker é obrigatório." });
        var result = await _quoteAppService.GetYahooQuoteAsync(ticker.Trim().ToUpper());
        if (result == null) return NotFound(new { error = "Preço não encontrado no Yahoo Finance." });
        return Ok(result);
    }

    [HttpGet("~/api/quotes/yahoo")]
    public async Task<IActionResult> GetYahooQuotes([FromQuery] string? tickers)
    {
        var tickerList = (tickers ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim().ToUpper()).ToList();
        if (!tickerList.Any()) return BadRequest(new { error = "Tickers são obrigatórios." });
        var result = await _quoteAppService.GetYahooQuotesAsync(tickerList);
        return Ok(result);
    }

    [HttpGet("~/api/quotes/sheets")]
    public async Task<IActionResult> GetSheetPrices([FromQuery] string? url, [FromQuery] string? key)
    {
        if (string.IsNullOrEmpty(url)) return BadRequest(new { error = "URL da planilha é obrigatória." });
        try
        {
            var result = await _quoteAppService.GetSheetPricesAsync(url, key);
            return Ok(result);
        }
        catch
        {
            return StatusCode(500, new { error = "Erro ao buscar preços da planilha." });
        }
    }
}
