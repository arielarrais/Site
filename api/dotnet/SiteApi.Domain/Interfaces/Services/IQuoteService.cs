namespace SiteApi.Domain.Interfaces.Services;

public interface IQuoteService
{
    Task<QuoteResult?> GetQuoteAsync(string ticker);
    Task<Dictionary<string, QuoteResult>> GetQuotesAsync(List<string> tickers);
}

public record QuoteResult(string Ticker, double Price, string? Name, double? ChangePercent, string? Time);
