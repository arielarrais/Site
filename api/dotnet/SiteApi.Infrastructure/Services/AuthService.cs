using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using SiteApi.Application.DTOs.Auth;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;

namespace SiteApi.Infrastructure.Services;

public class AuthService : IAuthService
{
    private readonly IUserRepository _userRepository;
    private readonly IConfiguration _config;

    public AuthService(IUserRepository userRepository, IConfiguration config)
    {
        _userRepository = userRepository;
        _config = config;
    }

    private string JwtSecret => _config["JwtSecret"] ?? "fallback_secret_change_me";

    private string GenerateToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim("id", user.Id.ToString()),
            new Claim("username", user.Username),
            new Claim("fullName", user.Fullname ?? user.Username)
        };
        var token = new JwtSecurityToken(claims: claims, expires: DateTime.UtcNow.AddHours(24), signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public async Task<LoginResponse> RegisterAsync(RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            throw new ArgumentException("Username and password are required.");

        if (request.Password.Length < 4)
            throw new ArgumentException("Password must be at least 4 characters.");

        if (await _userRepository.ExistsAsync(request.Username))
            throw new ArgumentException("Username already exists.");

        var user = new User
        {
            Username = request.Username,
            Password = BCrypt.Net.BCrypt.HashPassword(request.Password, 10),
            Fullname = request.FullName ?? request.Username,
            Email = request.Email
        };

        await _userRepository.AddAsync(user);

        return new LoginResponse(user.Id, user.Username, user.Fullname ?? user.Username, GenerateToken(user));
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            throw new ArgumentException("Username and password are required.");

        var user = await _userRepository.GetByUsernameAsync(request.Username)
            ?? throw new UnauthorizedAccessException("Invalid credentials.");

        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.Password))
            throw new UnauthorizedAccessException("Invalid credentials.");

        return new LoginResponse(user.Id, user.Username, user.Fullname ?? user.Username, GenerateToken(user));
    }
}
