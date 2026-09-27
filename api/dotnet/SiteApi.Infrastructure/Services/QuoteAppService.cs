using SiteApi.Application.DTOs.Quotes;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class QuoteAppService : IQuoteAppService
{
    private readonly BrapiQuoteService _brapiQuoteService;
    private readonly YahooQuoteService _yahooQuoteService;
    private readonly IGoogleSheetsService _googleSheetsService;

    public QuoteAppService(
        BrapiQuoteService brapiQuoteService,
        YahooQuoteService yahooQuoteService,
        IGoogleSheetsService googleSheetsService)
    {
        _brapiQuoteService = brapiQuoteService;
        _yahooQuoteService = yahooQuoteService;
        _googleSheetsService = googleSheetsService;
    }

    public async Task<QuoteDto> GetQuoteAsync(string ticker)
    {
        var result = await _brapiQuoteService.GetQuoteAsync(ticker);
        return result == null ? null! : new QuoteDto(result.Ticker, result.Price, result.Name, result.ChangePercent, result.Time);
    }

    public async Task<Dictionary<string, QuoteDto>> GetQuotesAsync(List<string> tickers)
    {
        var results = await _brapiQuoteService.GetQuotesAsync(tickers);
        return results.ToDictionary(
            kvp => kvp.Key,
            kvp => new QuoteDto(kvp.Value.Ticker, kvp.Value.Price, kvp.Value.Name, kvp.Value.ChangePercent, kvp.Value.Time));
    }

    public async Task<QuoteDto> GetYahooQuoteAsync(string ticker)
    {
        var result = await _yahooQuoteService.GetQuoteAsync(ticker);
        return result == null ? null! : new QuoteDto(result.Ticker, result.Price, result.Name, null, null);
    }

    public async Task<Dictionary<string, QuoteDto>> GetYahooQuotesAsync(List<string> tickers)
    {
        var results = await _yahooQuoteService.GetQuotesAsync(tickers);
        return results.ToDictionary(
            kvp => kvp.Key,
            kvp => new QuoteDto(kvp.Value.Ticker, kvp.Value.Price, kvp.Value.Name, null, null));
    }

    public async Task<Dictionary<string, object>> GetSheetPricesAsync(string url, string? apiKey)
    {
        return await _googleSheetsService.GetSheetPricesAsync(url, apiKey);
    }
}
