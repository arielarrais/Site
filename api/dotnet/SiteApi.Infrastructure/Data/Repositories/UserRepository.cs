using Microsoft.EntityFrameworkCore;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;

namespace SiteApi.Infrastructure.Data.Repositories;

public class UserRepository : IUserRepository
{
    private readonly AppDbContext _db;

    public UserRepository(AppDbContext db) => _db = db;

    public async Task<User?> GetByIdAsync(int id) =>
        await _db.Users.FindAsync(id);

    public async Task<User?> GetByUsernameAsync(string username) =>
        await _db.Users.FirstOrDefaultAsync(u => u.Username == username);

    public async Task<User> AddAsync(User user)
    {
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<bool> ExistsAsync(string username) =>
        await _db.Users.AnyAsync(u => u.Username == username);

    public async Task<List<User>> GetAllAsync() =>
        await _db.Users.OrderBy(u => u.Id).ToListAsync();
}
