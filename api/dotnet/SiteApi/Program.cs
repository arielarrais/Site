using System.Net;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using SiteApi.Infrastructure;
using SiteApi.Infrastructure.Data;

var builder = WebApplication.CreateBuilder(args);

// Segredos vem do ambiente (docker) ou do arquivo .env da raiz do repo (gitignored).
LoadDotEnv(builder.Configuration, builder.Environment.ContentRootPath);

builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        opts.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });

builder.Services.AddInfrastructure(builder.Configuration);

var jwtSecret = builder.Configuration["JwtSecret"];
if (string.IsNullOrWhiteSpace(jwtSecret) || Encoding.UTF8.GetByteCount(jwtSecret) < 32)
{
    throw new InvalidOperationException(
        "JwtSecret ausente ou curta (minimo de 32 bytes). Defina JWT_SECRET no arquivo .env da raiz do repo (veja .env.example) ou como variavel de ambiente.");
}
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                var claims = context.Principal?.Claims?.ToList();
                if (claims != null)
                {
                    context.HttpContext.Items["UserId"] = claims.FirstOrDefault(c => c.Type == "id")?.Value;
                    context.HttpContext.Items["Username"] = claims.FirstOrDefault(c => c.Type == "username")?.Value;
                    context.HttpContext.Items["FullName"] = claims.FirstOrDefault(c => c.Type == "fullName")?.Value;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

// O Caddy esta na frente e o rate limiter precisa do IP real do visitante.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(IPAddress.Parse("172.16.0.0"), 12));
    options.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(IPAddress.Parse("10.0.0.0"), 8));
});

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("admin", policy =>
        policy.RequireClaim("username", "admin", "admin@admin"));
});

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "desconhecido",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(5),
            QueueLimit = 0
        }));
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

app.UseForwardedHeaders();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

var clientPath = builder.Configuration["ClientPath"] ?? Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "..", "client");
Console.WriteLine($"[DEBUG] Client path: {Path.GetFullPath(clientPath)}");
Console.WriteLine($"[DEBUG] Exists: {Directory.Exists(clientPath)}");
var clientProvider = new PhysicalFileProvider(clientPath);

var publicPath = Path.Combine(clientPath, "public");
var publicProvider = new PhysicalFileProvider(publicPath);

// no-store: o navegador nunca pode reaproveitar JS/CSS de um deploy anterior
void NoCache(StaticFileResponseContext ctx) =>
    ctx.Context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";

app.UseStaticFiles(new StaticFileOptions { FileProvider = clientProvider, OnPrepareResponse = NoCache });
app.UseStaticFiles(new StaticFileOptions { FileProvider = publicProvider, OnPrepareResponse = NoCache });

app.MapControllers();

app.Run();

static void LoadDotEnv(ConfigurationManager config, string startDir)
{
    var dir = new DirectoryInfo(startDir);
    FileInfo? file = null;
    while (dir is not null)
    {
        file = dir.EnumerateFiles(".env").FirstOrDefault();
        if (file is not null) break;
        dir = dir.Parent;
    }
    if (file is null) return;

    foreach (var line in File.ReadAllLines(file.FullName))
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;

        var separator = trimmed.IndexOf('=');
        if (separator <= 0) continue;

        var key = trimmed[..separator].Trim();
        var value = trimmed[(separator + 1)..].Trim().Trim('"').Trim('\'');
        if (string.IsNullOrEmpty(key)) continue;

        // variavel de ambiente real tem prioridade sobre o .env
        if (config[key] is null) config[key] = value;
    }
}
