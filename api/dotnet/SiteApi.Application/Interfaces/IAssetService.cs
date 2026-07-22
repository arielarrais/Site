using SiteApi.Application.DTOs.Assets;

namespace SiteApi.Application.Interfaces;

public interface IAssetService
{
    Task<List<AssetDto>> SearchAsync(string? query);
    Task<Dictionary<string, string>> GetAssetTypesAsync(List<string> tickers);
    Task<AssetDto> AutoCreateAsync(string ticker);
}
