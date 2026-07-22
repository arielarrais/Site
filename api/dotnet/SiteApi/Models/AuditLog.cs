namespace SiteApi.Models;

public class AuditLog
{
    public int Id { get; set; }
    public int? Userid { get; set; }
    public string? Username { get; set; }
    public string? Action { get; set; }
    public string? Details { get; set; }
    public string? Createdat { get; set; }
}
