namespace SiteApi.Application.DTOs.Auth;

public record LoginResponse(int Id, string Username, string FullName, string Token);
