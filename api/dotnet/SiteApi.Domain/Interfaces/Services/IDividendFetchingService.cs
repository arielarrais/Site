using SiteApi.Domain.Entities;

namespace SiteApi.Domain.Interfaces.Services;

public interface IDividendFetchingService
{
    Task<FetchResult> FetchAndSyncAssetDividendsAsync(int assetId, string ticker);
}

public record FetchResult(string Source, int Inserted, int Updated, int Skipped, int Total);
