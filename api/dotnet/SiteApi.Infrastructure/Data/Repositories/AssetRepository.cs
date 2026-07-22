using Microsoft.EntityFrameworkCore;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;

namespace SiteApi.Infrastructure.Data.Repositories;

public class AssetRepository : IAssetRepository
{
    private readonly AppDbContext _db;

    public AssetRepository(AppDbContext db) => _db = db;

    public async Task<List<B3Asset>> SearchAsync(string query, int take = 30)
    {
        var upperQuery = query.Trim().ToUpper();
        return await _db.B3Assets
            .Where(a => a.Ticker.Contains(upperQuery) || (a.Name != null && a.Name.Contains(upperQuery)))
            .OrderBy(a => a.Ticker)
            .Take(take)
            .ToListAsync();
    }

    public async Task<List<B3Asset>> GetAllAsync() =>
        await _db.B3Assets.OrderBy(a => a.AssetType).ThenBy(a => a.Ticker).ToListAsync();

    public async Task<B3Asset?> GetByIdAsync(int id) =>
        await _db.B3Assets.FindAsync(id);

    public async Task<B3Asset?> GetByTickerAsync(string ticker) =>
        await _db.B3Assets.FirstOrDefaultAsync(a => a.Ticker == ticker);

    public async Task<B3Asset> AddAsync(B3Asset asset)
    {
        _db.B3Assets.Add(asset);
        await _db.SaveChangesAsync();
        return asset;
    }

    public async Task UpdateAsync(B3Asset asset)
    {
        _db.B3Assets.Update(asset);
        await _db.SaveChangesAsync();
    }

    public async Task<List<B3Asset>> GetByTickersAsync(List<string> tickers) =>
        await _db.B3Assets.Where(a => tickers.Contains(a.Ticker)).ToListAsync();
}
