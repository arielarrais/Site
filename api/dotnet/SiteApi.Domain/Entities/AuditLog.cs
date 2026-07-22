namespace SiteApi.Domain.Entities;

public class AuditLog
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public string? Username { get; set; }
    public string? Action { get; set; }
    public string? Details { get; set; }
    public string? CreatedAt { get; set; }
}
