using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SiteApi.Data;
using SiteApi.Models;

namespace SiteApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DividendsController : ControllerBase
{
    private readonly AppDbContext _db;

    public DividendsController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetDividends(
        [FromQuery] int? assetId,
        [FromQuery] string? ticker,
        [FromQuery] int? userId)
    {
        try
        {
            if (!string.IsNullOrEmpty(ticker))
            {
                var upperTicker = ticker.Trim().ToUpper();
                var result = await (from d in _db.AssetDividends
                                    join a in _db.B3Assets on d.Assetid equals a.Id
                                    where a.Ticker == upperTicker
                                    orderby d.Paymentdate descending
                                    select new
                                    {
                                        id = d.Id,
                                        assetId = d.Assetid,
                                        ticker = a.Ticker,
                                        comDate = d.Comdate,
                                        paymentDate = d.Paymentdate,
                                        grossAmount = d.Grossamount,
                                        netAmount = d.Netamount,
                                        description = d.Description,
                                        type = d.Type,
                                        createdAt = d.Createdat
                                    }).ToListAsync();
                return Ok(result);
            }
            else if (assetId.HasValue && assetId.Value > 0)
            {
                var result = await (from d in _db.AssetDividends
                                    join a in _db.B3Assets on d.Assetid equals a.Id
                                    where d.Assetid == assetId.Value
                                    orderby d.Paymentdate descending
                                    select new
                                    {
                                        id = d.Id,
                                        assetId = d.Assetid,
                                        ticker = a.Ticker,
                                        comDate = d.Comdate,
                                        paymentDate = d.Paymentdate,
                                        grossAmount = d.Grossamount,
                                        netAmount = d.Netamount,
                                        description = d.Description,
                                        type = d.Type,
                                        createdAt = d.Createdat
                                    }).ToListAsync();
                return Ok(result);
            }
            else if (userId.HasValue && userId.Value > 0)
            {
                var uid = userId.Value;
                var result = await (from d in _db.AssetDividends
                                    join a in _db.B3Assets on d.Assetid equals a.Id
                                    where d.Comdate != null
                                          && _db.PortfolioItems.Any(p =>
                                              p.Userid == uid && p.Ticker == a.Ticker && p.Purchasedat != null && string.Compare(p.Purchasedat, d.Comdate) <= 0)
                                    orderby d.Paymentdate descending
                                    select new
                                    {
                                        id = d.Id,
                                        assetId = d.Assetid,
                                        ticker = a.Ticker,
                                        comDate = d.Comdate,
                                        paymentDate = d.Paymentdate,
                                        grossAmount = d.Grossamount,
                                        netAmount = d.Netamount,
                                        description = d.Description,
                                        type = d.Type,
                                        createdAt = d.Createdat,
                                        sharesAtComDate = _db.PortfolioItems
                                            .Where(p => p.Userid == uid && p.Ticker == a.Ticker && p.Purchasedat != null && string.Compare(p.Purchasedat, d.Comdate) <= 0)
                                            .Sum(p => p.Movement_type == "venda" ? -(double)p.Quantity : (double)p.Quantity),
                                        totalReceived = d.Grossamount * _db.PortfolioItems
                                            .Where(p => p.Userid == uid && p.Ticker == a.Ticker && p.Purchasedat != null && string.Compare(p.Purchasedat, d.Comdate) <= 0)
                                            .Sum(p => p.Movement_type == "venda" ? -(double)p.Quantity : (double)p.Quantity)
                                    }).ToListAsync();

                result = result.Where(x => x.sharesAtComDate > 0).ToList();
                return Ok(result);
            }
            else
            {
                var result = await (from d in _db.AssetDividends
                                    join a in _db.B3Assets on d.Assetid equals a.Id
                                    orderby d.Paymentdate descending
                                    select new
                                    {
                                        id = d.Id,
                                        assetId = d.Assetid,
                                        ticker = a.Ticker,
                                        comDate = d.Comdate,
                                        paymentDate = d.Paymentdate,
                                        grossAmount = d.Grossamount,
                                        netAmount = d.Netamount,
                                        description = d.Description,
                                        type = d.Type,
                                        createdAt = d.Createdat
                                    }).ToListAsync();
                return Ok(result);
            }
        }
        catch (Exception)
        {
            return StatusCode(500, new { error = "Erro ao buscar dividendos." });
        }
    }

    [HttpGet("monthly")]
    public async Task<IActionResult> GetMonthlyDividends([FromQuery] int userId)
    {
        if (userId <= 0)
            return BadRequest(new { error = "userId é obrigatório." });

        try
        {
            var result = await (from d in _db.AssetDividends
                                join a in _db.B3Assets on d.Assetid equals a.Id
                                where d.Comdate != null
                                      && _db.PortfolioItems.Any(p =>
                                          p.Userid == userId && p.Ticker == a.Ticker && p.Purchasedat != null && string.Compare(p.Purchasedat, d.Comdate) <= 0)
                                group d by new
                                {
                                    ticker = a.Ticker,
                                    month = d.Comdate!.Substring(0, 7)
                                } into g
                                orderby g.Key.month descending, g.Key.ticker ascending
                                select new
                                {
                                    ticker = g.Key.ticker,
                                    month = g.Key.month,
                                    total = g.Sum(x => x.Grossamount * _db.PortfolioItems
                                        .Where(p => p.Userid == userId && p.Ticker == g.Key.ticker && p.Purchasedat != null && string.Compare(p.Purchasedat, x.Comdate) <= 0)
                                        .Sum(p => p.Movement_type == "venda" ? -(double)p.Quantity : (double)p.Quantity)),
                                    count = g.Count()
                                }).ToListAsync();

            var filtered = result.Where(x => x.total > 0).ToList();
            return Ok(filtered);
        }
        catch (Exception)
        {
            return StatusCode(500, new { error = "Erro ao buscar dividendos mensais." });
        }
    }

    [HttpPost]
    public async Task<IActionResult> CreateDividend([FromBody] DividendRequest req)
    {
        if (req.AssetId <= 0 || string.IsNullOrEmpty(req.PaymentDate) || req.GrossAmount <= 0)
            return BadRequest(new { error = "assetId, paymentDate e grossAmount são obrigatórios." });

        var paymentDate = req.PaymentDate.Trim();
        if (!Regex.IsMatch(paymentDate, @"^\d{4}-\d{2}-\d{2}$"))
            return BadRequest(new { error = "Data de pagamento deve estar no formato YYYY-MM-DD." });

        try
        {
            var dividend = new AssetDividend
            {
                Assetid = req.AssetId,
                Paymentdate = paymentDate,
                Grossamount = req.GrossAmount,
                Netamount = req.NetAmount,
                Description = req.Description?.Trim(),
                Type = req.Type ?? "dividendo"
            };
            _db.AssetDividends.Add(dividend);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                id = dividend.Id,
                assetId = dividend.Assetid,
                paymentDate = dividend.Paymentdate,
                grossAmount = dividend.Grossamount,
                netAmount = dividend.Netamount,
                description = dividend.Description,
                type = dividend.Type
            });
        }
        catch (Exception)
        {
            return StatusCode(500, new { error = "Erro ao salvar dividendo." });
        }
    }
}
