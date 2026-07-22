using SiteApi.Application.DTOs.Portfolio;
using SiteApi.Domain.Entities;

namespace SiteApi.Application.Interfaces;

public interface IPortfolioService
{
    Task<List<PortfolioItemDto>> GetByUserIdAsync(int userId);
    Task<PortfolioItemDto> AddAsync(CreatePortfolioItemRequest request);
    Task<PortfolioItemDto> UpdateAsync(UpdatePortfolioItemRequest request);
    Task DeleteAsync(int userId, int id);
    Task ClearAsync(int userId);
    Task<List<object>> GetDividendReturnsAsync(int userId);
}
