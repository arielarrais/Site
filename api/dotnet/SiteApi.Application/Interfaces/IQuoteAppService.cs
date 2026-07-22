using SiteApi.Application.DTOs.Quotes;

namespace SiteApi.Application.Interfaces;

public interface IQuoteAppService
{
    Task<QuoteDto> GetQuoteAsync(string ticker);
    Task<Dictionary<string, QuoteDto>> GetQuotesAsync(List<string> tickers);
    Task<QuoteDto> GetYahooQuoteAsync(string ticker);
    Task<Dictionary<string, QuoteDto>> GetYahooQuotesAsync(List<string> tickers);
    Task<Dictionary<string, object>> GetSheetPricesAsync(string url, string? apiKey);
}
