using SiteApi.Domain.Entities;

namespace SiteApi.Domain.Interfaces.Repositories;

public interface IPortfolioRepository
{
    Task<List<PortfolioItem>> GetByUserIdAsync(int userId);
    Task<PortfolioItem?> GetByIdAsync(int id);
    Task<PortfolioItem> AddAsync(PortfolioItem item);
    Task UpdateAsync(PortfolioItem item);
    Task DeleteAsync(int id);
    Task DeleteByUserIdAsync(int userId);
    Task<int> CountByUserIdAsync(int userId);
}
