namespace SiteApi.Application.DTOs.Assets;

public record AssetDto(
    int Id,
    string Ticker,
    string? Name,
    string? AssetType,
    string? RegularMarketPrice
);
