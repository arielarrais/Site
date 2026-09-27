namespace SiteApi.Application.DTOs.Dividends;

public record DividendCalendarMonthDto(
    int Month,
    double PerShare,
    double Total,
    int Payments
);

public record DividendCalendarRowDto(
    string Ticker,
    string? Name,
    string? AssetType,
    bool IsFii,
    List<DividendCalendarMonthDto> Months,
    double PerShareYear,
    double TotalYear
);

public record DividendCalendarDto(
    int Year,
    List<int> AvailableYears,
    List<DividendCalendarRowDto> Rows
);
