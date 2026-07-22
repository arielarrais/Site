namespace SiteApi.Application.DTOs.Auth;

public record RegisterRequest(string Username, string Password, string? FullName, string? Email);
