using SiteApi.Domain.Entities;

namespace SiteApi.Domain.Interfaces.Repositories;

public interface IDividendRepository
{
    Task<List<AssetDividend>> GetByAssetIdAsync(int assetId);
    Task<List<AssetDividend>> GetByTickerAsync(string ticker);
    Task<List<AssetDividend>> GetByUserIdAsync(int userId);
    Task<AssetDividend?> GetByAssetAndComDateAsync(int assetId, string comDate);
    Task<AssetDividend> AddAsync(AssetDividend dividend);
    Task UpdateAsync(AssetDividend dividend);
    Task<List<AssetDividend>> GetAllAsync();
}
