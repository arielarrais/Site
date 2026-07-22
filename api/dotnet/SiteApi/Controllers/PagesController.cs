using Microsoft.AspNetCore.Mvc;

namespace SiteApi.Presentation.Controllers;

[ApiController]
[Route("")]
public class PagesController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    public PagesController(IWebHostEnvironment env) => _env = env;

    private string ClientPath => Path.Combine(_env.ContentRootPath, "..", "..", "client");

    private IActionResult ServePage(string page)
    {
        var path = Path.Combine(ClientPath, page);
        if (System.IO.File.Exists(path))
            return Content(System.IO.File.ReadAllText(path), "text/html");
        return NotFound();
    }

    [HttpGet("/")] public IActionResult Login() => ServePage("login.html");
    [HttpGet("/dashboard")] public IActionResult Dashboard() => ServePage("dashboard.html");
    [HttpGet("/lancamentos")] public IActionResult Lancamentos() => ServePage("lancamentos.html");
    [HttpGet("/dividendos")] public IActionResult Dividendos() => ServePage("dividendos.html");
    [HttpGet("/ativos")] public IActionResult Ativos() => ServePage("ativos.html");
    [HttpGet("/usuarios")] public IActionResult Usuarios() => ServePage("usuarios.html");
    [HttpGet("/configuracoes")] public IActionResult Configuracoes() => ServePage("configuracoes.html");
}
