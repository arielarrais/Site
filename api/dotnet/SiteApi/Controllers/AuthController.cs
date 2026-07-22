using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SiteApi.Data;
using SiteApi.Models;

namespace SiteApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;

    public AuthController(AppDbContext db, IConfiguration config)
    {
        _db = db;
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
        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddHours(24),
            signingCredentials: creds
        );
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    [HttpPost("~/api/register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { error = "Usuário e senha são obrigatórios." });

        if (req.Password.Length < 4)
            return BadRequest(new { error = "Senha deve ter pelo menos 4 caracteres." });

        var exists = await _db.Users.FirstOrDefaultAsync(u => u.Username == req.Username);
        if (exists != null)
            return BadRequest(new { error = "Usuário já existe." });

        var user = new User
        {
            Username = req.Username,
            Password = BCrypt.Net.BCrypt.HashPassword(req.Password, 10),
            Fullname = req.FullName ?? req.Username,
            Email = req.Email
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok(new { id = user.Id, username = user.Username, fullName = user.Fullname, email = user.Email });
    }

    [HttpPost("~/api/login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { error = "Usuário e senha são obrigatórios." });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == req.Username);
        if (user == null || !BCrypt.Net.BCrypt.Verify(req.Password, user.Password))
            return Unauthorized(new { error = "Usuário ou senha inválidos." });

        var token = GenerateToken(user);
        return Ok(new { id = user.Id, username = user.Username, fullName = user.Fullname, token });
    }

    [Authorize]
    [HttpGet("~/api/auth/validate")]
    public IActionResult Validate()
    {
        var userId = HttpContext.Items["UserId"]?.ToString();
        var username = HttpContext.Items["Username"]?.ToString();
        var fullName = HttpContext.Items["FullName"]?.ToString();

        return Ok(new { id = int.TryParse(userId, out var id) ? id : 0, username, fullName });
    }

    [HttpGet("~/api/test")]
    public IActionResult Test()
    {
        return Ok(new { status = "ok", version = 2 });
    }

    [HttpPost("~/api/test/seed-admin")]
    public async Task<IActionResult> SeedAdmin()
    {
        var exists = await _db.Users.FirstOrDefaultAsync(u => u.Username == "admin");
        if (exists != null)
            return Ok(new { message = "Admin já existe." });

        var user = new User
        {
            Username = "admin",
            Password = BCrypt.Net.BCrypt.HashPassword("123456", 10),
            Fullname = "Administrador"
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Usuário inicial criado: admin / 123456" });
    }
}
