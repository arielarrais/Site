using SiteApi.Application.DTOs.Dividends;

namespace SiteApi.Application.Interfaces;

public interface IDividendService
{
    Task<List<DividendDto>> GetByTickerAsync(string ticker);
    Task<List<DividendDto>> GetByAssetIdAsync(int assetId);
    Task<List<DividendDto>> GetByUserIdAsync(int userId);
    Task<List<MonthlyDividendDto>> GetMonthlyAsync(int userId);
    Task<DividendDto> CreateAsync(CreateDividendRequest request);
}
