namespace SiteApi.Application.DTOs.Dividends;

public record MonthlyDividendDto(
    string Ticker,
    string Month,
    double Total,
    int Count
);
