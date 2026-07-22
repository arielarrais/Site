namespace SiteApi.Models;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string? Fullname { get; set; }
    public string? Email { get; set; }
}
