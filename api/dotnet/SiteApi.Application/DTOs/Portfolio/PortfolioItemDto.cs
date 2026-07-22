namespace SiteApi.Application.DTOs.Portfolio;

public record PortfolioItemDto(
    int Id,
    string Ticker,
    int Quantity,
    double PurchasePrice,
    string? PurchaseDate,
    string? Institution,
    string? MovementType
);
