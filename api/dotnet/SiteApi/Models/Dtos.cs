namespace SiteApi.Models;

public record RegisterRequest(string Username, string Password, string? FullName, string? Email);
public record LoginRequest(string Username, string Password);
public record LoginResponse(int Id, string Username, string FullName, string Token);
public record PortfolioRequest(int UserId, string Ticker, int Quantity, double PurchasePrice, string PurchaseDate, string? Institution, string? MovementType);
public record PortfolioUpdateRequest(int Id, int UserId, int? Quantity, double? PurchasePrice, string? PurchaseDate);
public record DividendRequest(int AssetId, string PaymentDate, double GrossAmount, double? NetAmount, string? Description, string? Type);
public record AdminDividendRequest(int AssetId, string ComDate, string PaymentDate, double GrossAmount, string? Type);
public record SyncBrapiRequest(string Ticker);
public record FetchDividendsRequest(string Ticker);
public record AutoCreateRequest(string Ticker);
public record CreateAssetRequest(string Ticker, string Name, string? AssetType);
public record ClearPortfolioRequest(int UserId);
public record ParseXlsxRequest(int UserId, string FileBase64);
public record QuoteResponse(string Ticker, double? Price, string? Name, double? ChangePercent, string? Time);
public record AssetTypeResponse(string Ticker, string AssetType);
