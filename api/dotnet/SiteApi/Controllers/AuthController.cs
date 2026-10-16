using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using SiteApi.Application.DTOs.Auth;
using SiteApi.Application.Interfaces;

namespace SiteApi.Presentation.Controllers;

[ApiController]
public class AuthController : SecureApiController
{
    private readonly IAuthService _authService;
    private readonly IConfiguration _config;

    public AuthController(IAuthService authService, IConfiguration config)
    {
        _authService = authService;
        _config = config;
    }

    private bool AllowSelfRegistration =>
        bool.TryParse(_config["AllowSelfRegistration"], out var allowed) && allowed;

    [HttpGet("~/api/auth/config")]
    public IActionResult GetAuthConfig() => Ok(new { allowSelfRegistration = AllowSelfRegistration });

    [EnableRateLimiting("auth")]
    [HttpPost("~/api/register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        // Sem registro aberto so o admin cria usuarios (o painel /usuarios).
        if (!AllowSelfRegistration && !IsAdmin)
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Registro desativado. Peça a um administrador para criar seu usuario." });

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

    [EnableRateLimiting("auth")]
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
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [Authorize]
    [HttpPost("~/api/auth/change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest req)
    {
        if (!TryGetCurrentUserId(out var userId))
            return Unauthorized(new { error = "Sessao invalida." });

        try
        {
            await _authService.ChangePasswordAsync(userId, req.CurrentPassword ?? "", req.NewPassword ?? "");
            return Ok(new { success = true, message = "Senha alterada." });
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

    [AllowAnonymous]
    [HttpGet("~/api/test")]
    public IActionResult Test() => Ok(new { status = "ok", version = 3 });
}