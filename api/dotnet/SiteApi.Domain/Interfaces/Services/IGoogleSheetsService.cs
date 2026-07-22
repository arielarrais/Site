namespace SiteApi.Domain.Interfaces.Services;

public interface IGoogleSheetsService
{
    Task<Dictionary<string, object>> GetSheetPricesAsync(string url, string? apiKey);
}
