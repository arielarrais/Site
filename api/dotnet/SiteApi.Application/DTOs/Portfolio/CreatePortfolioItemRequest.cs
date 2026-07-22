namespace SiteApi.Application.DTOs.Portfolio;

public record CreatePortfolioItemRequest(
    int UserId,
    string Ticker,
    int Quantity,
    double PurchasePrice,
    string PurchaseDate,
    string? Institution,
    string? MovementType
);
