using SiteApi.Application.DTOs.Auth;

namespace SiteApi.Application.Interfaces;

public interface IAuthService
{
    Task<LoginResponse> RegisterAsync(RegisterRequest request);
    Task<LoginResponse> LoginAsync(LoginRequest request);
    Task ChangePasswordAsync(int userId, string currentPassword, string newPassword);
}
