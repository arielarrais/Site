using Microsoft.AspNetCore.Mvc;

namespace SiteApi.Controllers;

[ApiController]
[Route("")]
public class PagesController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    public PagesController(IWebHostEnvironment env)
    {
        _env = env;
    }

    private string GetClientPath()
    {
        // From bin/Debug/net11.0, go up to project root then to ../../client/
        var contentRoot = _env.ContentRootPath;
        return Path.Combine(contentRoot, "..", "..", "..", "..", "client");
    }

    private IActionResult ServeFile(string fileName)
    {
        var clientDir = GetClientPath();
        var filePath = Path.Combine(clientDir, fileName);
        if (!System.IO.File.Exists(filePath))
            return NotFound(new { error = $"Arquivo {fileName} não encontrado." });
        return PhysicalFile(filePath, "text/html");
    }

    [HttpGet("/")]
    public IActionResult Index() => ServeFile("login.html");

    [HttpGet("/dashboard")]
    public IActionResult Dashboard() => ServeFile("dashboard.html");

    [HttpGet("/lancamentos")]
    public IActionResult Lancamentos() => ServeFile("lancamentos.html");

    [HttpGet("/dividendos")]
    public IActionResult Dividendos() => ServeFile("dividendos.html");

    [HttpGet("/ativos")]
    public IActionResult Ativos() => ServeFile("ativos.html");

    [HttpGet("/usuarios")]
    public IActionResult Usuarios() => ServeFile("usuarios.html");

    [HttpGet("/configuracoes")]
    public IActionResult Configuracoes() => ServeFile("configuracoes.html");
}
