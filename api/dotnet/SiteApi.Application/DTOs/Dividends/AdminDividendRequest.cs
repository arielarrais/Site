namespace SiteApi.Application.DTOs.Dividends;

public record AdminDividendRequest(
    int AssetId,
    string ComDate,
    string PaymentDate,
    double GrossAmount,
    string? Type
);
