using SiteApi.Domain.Entities;

namespace SiteApi.Domain.Interfaces.Repositories;

public interface IUserRepository
{
    Task<User?> GetByIdAsync(int id);
    Task<User?> GetByUsernameAsync(string username);
    Task<User> AddAsync(User user);
    Task<bool> ExistsAsync(string username);
    Task<List<User>> GetAllAsync();
}
