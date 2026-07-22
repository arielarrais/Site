using SiteApi.Application.DTOs.Dividends;

namespace SiteApi.Application.Interfaces;

public interface IAdminService
{
    Task<List<object>> GetAssetsAsync();
    Task<List<object>> GetDividendsAsync(int? assetId);
    Task<DividendDto> CreateDividendAsync(AdminDividendRequest request);
    Task<Dictionary<string, object>> SyncBrapiAsync(string ticker);
    Task<object> FetchDividendsAsync(string ticker);
    Task<object> FetchAllDividendsAsync();
    Task<object> SyncDividendsAsync();
    Task<object> FixPaymentDatesAsync();
    Task<object> SyncTickersSheetAsync();
    Task<List<object>> GetUsersAsync();
}
