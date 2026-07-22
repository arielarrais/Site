namespace SiteApi.Application.DTOs.Portfolio;

public record UpdatePortfolioItemRequest(
    int Id,
    int UserId,
    int? Quantity,
    double? PurchasePrice,
    string? PurchaseDate
);
