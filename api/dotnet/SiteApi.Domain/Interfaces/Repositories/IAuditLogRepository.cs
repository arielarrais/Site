using SiteApi.Domain.Entities;

namespace SiteApi.Domain.Interfaces.Repositories;

public interface IAuditLogRepository
{
    Task<AuditLog> AddAsync(AuditLog log);
}
