namespace SiteApi.Domain.Interfaces.Services;

public interface IXlsxParserService
{
    List<Dictionary<string, object>> ParseB3Xlsx(string fileBase64);
}
