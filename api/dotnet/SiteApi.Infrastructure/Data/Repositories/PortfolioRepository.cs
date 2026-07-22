using Microsoft.EntityFrameworkCore;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;

namespace SiteApi.Infrastructure.Data.Repositories;

public class PortfolioRepository : IPortfolioRepository
{
    private readonly AppDbContext _db;

    public PortfolioRepository(AppDbContext db) => _db = db;

    public async Task<List<PortfolioItem>> GetByUserIdAsync(int userId) =>
        await _db.PortfolioItems
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.PurchaseDate).ThenBy(p => p.Id)
            .ToListAsync();

    public async Task<PortfolioItem?> GetByIdAsync(int id) =>
        await _db.PortfolioItems.FindAsync(id);

    public async Task<PortfolioItem> AddAsync(PortfolioItem item)
    {
        _db.PortfolioItems.Add(item);
        await _db.SaveChangesAsync();
        return item;
    }

    public async Task UpdateAsync(PortfolioItem item)
    {
        _db.PortfolioItems.Update(item);
        await _db.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var item = await _db.PortfolioItems.FindAsync(id);
        if (item != null)
        {
            _db.PortfolioItems.Remove(item);
            await _db.SaveChangesAsync();
        }
    }

    public async Task DeleteByUserIdAsync(int userId)
    {
        var items = await _db.PortfolioItems.Where(p => p.UserId == userId).ToListAsync();
        _db.PortfolioItems.RemoveRange(items);
        await _db.SaveChangesAsync();
    }

    public async Task<int> CountByUserIdAsync(int userId) =>
        await _db.PortfolioItems.CountAsync(p => p.UserId == userId);
}
