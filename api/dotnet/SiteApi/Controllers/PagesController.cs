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

    private IActionResult ServePage(string page)
    {
        var path = Path.Combine(ClientPath, page);
        if (!System.IO.File.Exists(path))
            return NotFound();

        // o HTML nunca deve ficar em cache: um deploy novo precisa chegar na hora
        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        return Content(System.IO.File.ReadAllText(path), "text/html");
    }

    [HttpGet("/")] public IActionResult Login() => ServePage("login.html");
    [HttpGet("/dashboard")] public IActionResult Dashboard() => ServePage("dashboard.html");
    [HttpGet("/lancamentos")] public IActionResult Lancamentos() => ServePage("lancamentos.html");
    [HttpGet("/dividendos")] public IActionResult Dividendos() => ServePage("dividendos.html");
    [HttpGet("/ativos")] public IActionResult Ativos() => ServePage("ativos.html");
    [HttpGet("/usuarios")] public IActionResult Usuarios() => ServePage("usuarios.html");
    [HttpGet("/configuracoes")] public IActionResult Configuracoes() => ServePage("configuracoes.html");
}
