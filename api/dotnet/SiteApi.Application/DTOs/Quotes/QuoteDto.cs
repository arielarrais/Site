namespace SiteApi.Application.DTOs.Quotes;

public record QuoteDto(
    string Ticker,
    double? Price,
    string? Name,
    double? ChangePercent,
    string? Time
);
