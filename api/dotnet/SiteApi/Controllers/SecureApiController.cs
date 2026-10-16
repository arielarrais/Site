using Microsoft.AspNetCore.Mvc;

namespace SiteApi.Presentation.Controllers;

public abstract class SecureApiController : ControllerBase
{
    protected int CurrentUserId =>
        int.TryParse(HttpContext.Items["UserId"]?.ToString(), out var id) ? id : 0;

    protected bool IsAdmin =>
        User.Identity?.IsAuthenticated == true &&
        User.FindFirst("username")?.Value is "admin" or "admin@admin";

    protected bool TryGetCurrentUserId(out int userId)
    {
        userId = CurrentUserId;
        return userId > 0;
    }
}