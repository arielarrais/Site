using ClosedXML.Excel;
using SiteApi.Domain.Interfaces.Services;

namespace SiteApi.Infrastructure.Services;

public class XlsxParserService : IXlsxParserService
{
    public List<Dictionary<string, object>> ParseB3Xlsx(string fileBase64)
    {
        var bytes = Convert.FromBase64String(fileBase64);
        using var stream = new MemoryStream(bytes);
        using var wb = new XLWorkbook(stream);
        var sheet = wb.Worksheets.Worksheet("Movimentação");
        if (sheet == null)
            throw new Exception("Planilha não contém a aba \"Movimentação\".");

        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? 1;
        var assets = new List<Dictionary<string, object>>();
        var positions = new Dictionary<string, (int quantity, double totalCost)>();

        for (int i = 2; i <= lastRow; i++)
        {
            var entry = (sheet.Cell(i, 1).GetString() ?? "").Trim();
            var dateRaw = (sheet.Cell(i, 2).GetString() ?? "").Trim();
            var mov = (sheet.Cell(i, 3).GetString() ?? "").Trim();
            var prod = (sheet.Cell(i, 4).GetString() ?? "").Trim();
            var inst = (sheet.Cell(i, 5).GetString() ?? "").Trim();
            var qty = (int)(sheet.Cell(i, 6).GetDouble());
            var priceStr = (sheet.Cell(i, 7).GetString() ?? "0").Replace(',', '.');
            double.TryParse(priceStr, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var price);
            var ticker = prod.Split(" - ")[0].Trim();

            if (string.IsNullOrEmpty(ticker) || ticker.Length < 4 || ticker == "-" || qty <= 0) continue;

            if (!positions.ContainsKey(ticker))
                positions[ticker] = (0, 0);
            var p = positions[ticker];
            var date = !string.IsNullOrEmpty(dateRaw) ? dateRaw.Split('/').Reverse().Aggregate((a, b) => $"{a}-{b}") : DateTime.UtcNow.ToString("yyyy-MM-dd");

            if (mov == "Transferência - Liquidação" && entry == "Credito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = qty, ["purchasePrice"] = price, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "compra" });
                p.quantity += qty; p.totalCost += qty * price;
            }
            else if (mov == "Transferência - Liquidação" && entry == "Debito")
            {
                var avgPrice = p.quantity > 0 ? Math.Round(p.totalCost / p.quantity, 2) : 0;
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = -qty, ["purchasePrice"] = avgPrice, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "venda" });
                p.quantity -= qty; p.totalCost -= qty * avgPrice;
            }
            else if (mov == "Transferência" && entry == "Debito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = -qty, ["purchasePrice"] = 0, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "venda" });
                if (p.quantity > 0) p.quantity -= qty;
            }
            else if (mov == "Bonificação em Ativos" && entry == "Credito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = qty, ["purchasePrice"] = 0, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "bonificacao" });
                p.quantity += qty;
            }
            else if (mov == "Desdobro" && entry == "Credito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = qty, ["purchasePrice"] = 0, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "desdobro" });
                p.quantity += qty;
            }
            else if (mov == "Grupamento" && entry == "Credito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = qty, ["purchasePrice"] = 0, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "grupamento" });
                p.quantity += qty;
            }
            else if (mov == "Incorporação" && entry == "Credito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = qty, ["purchasePrice"] = 0, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "incorporacao" });
                p.quantity += qty;
            }
            else if (mov == "Fração em Ativos" && entry == "Debito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = -qty, ["purchasePrice"] = 0, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "fracao" });
                if (p.quantity > 0) p.quantity -= qty;
            }
            else if (mov == "Leilão de Fração" && entry == "Credito")
            {
                assets.Add(new() { ["ticker"] = ticker, ["quantity"] = qty, ["purchasePrice"] = price, ["purchaseDate"] = date, ["institution"] = inst, ["movementType"] = "leilao" });
                p.quantity += qty; p.totalCost += qty * price;
            }

            positions[ticker] = p;
        }

        return assets.OrderBy(a => a["purchaseDate"].ToString()).ThenBy(a => a["ticker"].ToString()).ToList();
    }
}
