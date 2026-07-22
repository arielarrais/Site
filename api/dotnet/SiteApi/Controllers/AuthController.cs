using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SiteApi.Application.DTOs.Auth;
using SiteApi.Application.Interfaces;

namespace SiteApi.Presentation.Controllers;

[ApiController]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService) => _authService = authService;

    [HttpPost("~/api/register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        try
        {
            var result = await _authService.RegisterAsync(req);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("~/api/login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        try
        {
            var result = await _authService.LoginAsync(req);
            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { error = ex.Message });
        }
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
    public IActionResult Test() => Ok(new { status = "ok", version = 3 });
}
