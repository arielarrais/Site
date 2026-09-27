using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace SiteApi.Presentation.Controllers;

[ApiController]
[Route("")]
public class PagesController : ControllerBase
{
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;

    public PagesController(IWebHostEnvironment env, IConfiguration config)
    {
        _env = env;
        _config = config;
    }

    private string ClientPath => _config["ClientPath"] ?? Path.Combine(_env.ContentRootPath, "..", "..", "..", "client");

    private static readonly Regex TagAsset = new("(href|src)=\"(?<url>/?(styles\\.css|[a-zA-Z0-9._-]+\\.js))\"", RegexOptions.Compiled);

    /// <summary>
    /// Assinatura dos arquivos do front: muda sozinha a cada alteracao em client/,
    /// forcando o navegador a baixar a versao nova em vez de reaproveitar cache.
    /// </summary>
    private string BuildVersion()
    {
        var client = ClientPath;
        if (!Directory.Exists(client))
            return "0";

        var newest = Directory
            .EnumerateFiles(client, "*", SearchOption.AllDirectories)
            .Where(f => f.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
                     || f.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
                     || f.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            .Select(f => System.IO.File.GetLastWriteTimeUtc(f))
            .DefaultIfEmpty(DateTime.UnixEpoch)
            .Max();

        return newest.ToString("yyyyMMddHHmmss");
    }

    private IActionResult ServePage(string page)
    {
        var path = Path.Combine(ClientPath, page);
        if (!System.IO.File.Exists(path))
            return NotFound();

        var version = BuildVersion();
        var html = TagAsset.Replace(
            System.IO.File.ReadAllText(path),
            m => $"{m.Groups[1].Value}=\"{m.Groups[2].Value}?v={version}\"");

        // carimbo da build: confirma em qual versao o navegador esta rodando
        var stamp = $"<div class=\"build-stamp\" id=\"build-stamp\" data-build=\"{version}\">build {version}</div>";
        html = html.Contains("</body>")
            ? html.Replace("</body>", stamp + "</body>")
            : html + stamp;

        // o HTML nunca deve ficar em cache: um deploy novo precisa chegar na hora
        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        return Content(html, "text/html");
    }

    [HttpGet("/")] public IActionResult Login() => ServePage("login.html");
    [HttpGet("/dashboard")] public IActionResult Dashboard() => ServePage("dashboard.html");
    [HttpGet("/lancamentos")] public IActionResult Lancamentos() => ServePage("lancamentos.html");
    [HttpGet("/dividendos")] public IActionResult Dividendos() => ServePage("dividendos.html");
    [HttpGet("/ativos")] public IActionResult Ativos() => ServePage("ativos.html");
    [HttpGet("/usuarios")] public IActionResult Usuarios() => ServePage("usuarios.html");
    [HttpGet("/configuracoes")] public IActionResult Configuracoes() => ServePage("configuracoes.html");
}
