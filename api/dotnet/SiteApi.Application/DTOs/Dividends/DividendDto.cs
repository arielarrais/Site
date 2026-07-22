namespace SiteApi.Application.DTOs.Dividends;

public record DividendDto(
    int Id,
    int AssetId,
    string? Ticker,
    string? ComDate,
    string? PaymentDate,
    double? GrossAmount,
    double? NetAmount,
    string? Description,
    string? Type,
    string? CreatedAt
);
