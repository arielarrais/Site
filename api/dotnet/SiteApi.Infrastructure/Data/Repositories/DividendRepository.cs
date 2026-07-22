using Microsoft.EntityFrameworkCore;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;

namespace SiteApi.Infrastructure.Data.Repositories;

public class DividendRepository : IDividendRepository
{
    private readonly AppDbContext _db;

    public DividendRepository(AppDbContext db) => _db = db;

    public async Task<List<AssetDividend>> GetByAssetIdAsync(int assetId) =>
        await _db.AssetDividends
            .Where(d => d.AssetId == assetId)
            .OrderByDescending(d => d.PaymentDate)
            .ToListAsync();

    public async Task<List<AssetDividend>> GetByTickerAsync(string ticker) =>
        await (from d in _db.AssetDividends
               join a in _db.B3Assets on d.AssetId equals a.Id
               where a.Ticker == ticker
               orderby d.PaymentDate descending
               select d).ToListAsync();

    public async Task<List<AssetDividend>> GetByUserIdAsync(int userId) =>
        await (from d in _db.AssetDividends
               join a in _db.B3Assets on d.AssetId equals a.Id
               where d.ComDate != null
                     && _db.PortfolioItems.Any(p =>
                         p.UserId == userId && p.Ticker == a.Ticker && p.PurchaseDate != null && string.Compare(p.PurchaseDate, d.ComDate) <= 0)
               orderby d.PaymentDate descending
               select d).ToListAsync();

    public async Task<AssetDividend?> GetByAssetAndComDateAsync(int assetId, string comDate) =>
        await _db.AssetDividends.FirstOrDefaultAsync(d => d.AssetId == assetId && d.ComDate == comDate);

    public async Task<AssetDividend> AddAsync(AssetDividend dividend)
    {
        _db.AssetDividends.Add(dividend);
        await _db.SaveChangesAsync();
        return dividend;
    }

    public async Task UpdateAsync(AssetDividend dividend)
    {
        _db.AssetDividends.Update(dividend);
        await _db.SaveChangesAsync();
    }

    public async Task<List<AssetDividend>> GetAllAsync() =>
        await _db.AssetDividends.OrderByDescending(d => d.PaymentDate).ToListAsync();
}
