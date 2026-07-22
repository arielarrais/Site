namespace SiteApi.Application.DTOs.Dividends;

public record CreateDividendRequest(
    int AssetId,
    string PaymentDate,
    double GrossAmount,
    double? NetAmount,
    string? Description,
    string? Type
);
