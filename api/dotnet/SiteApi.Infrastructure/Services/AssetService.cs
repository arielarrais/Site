using System.Text.Json;
using SiteApi.Application.DTOs.Assets;
using SiteApi.Application.Interfaces;
using SiteApi.Domain.Entities;
using SiteApi.Domain.Interfaces.Repositories;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class AssetService : IAssetService
{
    private readonly IAssetRepository _assetRepo;
    private readonly IQuoteService _quoteService;

    public AssetService(IAssetRepository assetRepo, IQuoteService quoteService)
    {
        _assetRepo = assetRepo;
        _quoteService = quoteService;
    }

    public async Task<List<AssetDto>> SearchAsync(string? query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            var all = await _assetRepo.GetAllAsync();
            return all.Select(MapToDto).ToList();
        }

        var results = await _assetRepo.SearchAsync(query.Trim());
        return results.Select(MapToDto).ToList();
    }

    public async Task<Dictionary<string, string>> GetAssetTypesAsync(List<string> tickers)
    {
        var result = new Dictionary<string, string>();
        var assets = await _assetRepo.GetByTickersAsync(tickers);

        foreach (var asset in assets)
            result[asset.Ticker] = asset.AssetType ?? "other";

        var missing = tickers.Where(t => !result.ContainsKey(t)).ToList();
        if (missing.Any())
        {
            try
            {
                var quotes = await _quoteService.GetQuotesAsync(missing);
                foreach (var ticker in missing)
                {
                    if (quotes.TryGetValue(ticker, out var q))
                    {
                        var type = DetectType(ticker, q.Name);
                        result[ticker] = type;
                    }
                    else
                    {
                        result[ticker] = "other";
                    }
                }
            }
            catch
            {
                foreach (var ticker in missing)
                    result.TryAdd(ticker, "other");
            }
        }

        return result;
    }

    public async Task<AssetDto> AutoCreateAsync(string ticker)
    {
        ticker = ticker.Trim().ToUpper();
        var existing = await _assetRepo.GetByTickerAsync(ticker);
        if (existing != null) return MapToDto(existing);

        var quote = await _quoteService.GetQuoteAsync(ticker);
        if (quote == null)
            throw new Exception($"Ativo {ticker} não encontrado na Brapi.");

        var type = DetectType(ticker, quote.Name);
        var asset = new B3Asset
        {
            Ticker = ticker,
            Name = quote.Name ?? ticker,
            AssetType = type,
            RegularMarketPrice = quote.Price.ToString("F2")
        };

        await _assetRepo.AddAsync(asset);
        return MapToDto(asset);
    }

    private static AssetDto MapToDto(B3Asset a) =>
        new(a.Id, a.Ticker, a.Name, a.AssetType, a.RegularMarketPrice);

    private static string DetectType(string ticker, string? name)
    {
        if (ticker.EndsWith("11") && ticker.Length <= 6) return "fii";
        if (ticker.StartsWith("W") && ticker.Length <= 6) return "bdr";
        if (ticker.Contains("11F")) return "fii";
        return "acao";
    }
}
