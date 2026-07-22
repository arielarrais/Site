using SiteApi.Domain.Entities;

namespace SiteApi.Domain.Interfaces.Repositories;

public interface IAssetRepository
{
    Task<List<B3Asset>> SearchAsync(string query, int take = 30);
    Task<List<B3Asset>> GetAllAsync();
    Task<B3Asset?> GetByIdAsync(int id);
    Task<B3Asset?> GetByTickerAsync(string ticker);
    Task<B3Asset> AddAsync(B3Asset asset);
    Task UpdateAsync(B3Asset asset);
    Task<List<B3Asset>> GetByTickersAsync(List<string> tickers);
}
