using Microsoft.EntityFrameworkCore;
using SiteApi.Domain.Entities;

namespace SiteApi.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<PortfolioItem> PortfolioItems => Set<PortfolioItem>();
    public DbSet<B3Asset> B3Assets => Set<B3Asset>();
    public DbSet<AssetDividend> AssetDividends => Set<AssetDividend>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.Username).HasColumnName("username");
            e.Property(x => x.Password).HasColumnName("password");
            e.Property(x => x.Fullname).HasColumnName("fullname");
            e.Property(x => x.Email).HasColumnName("email");
        });

        modelBuilder.Entity<PortfolioItem>(e =>
        {
            e.ToTable("portfolio_items");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.UserId).HasColumnName("userid");
            e.Property(x => x.Ticker).HasColumnName("ticker");
            e.Property(x => x.Quantity).HasColumnName("quantity");
            e.Property(x => x.PurchasePrice).HasColumnName("purchaseprice");
            e.Property(x => x.PurchaseDate).HasColumnName("purchasedat");
            e.Property(x => x.Institution).HasColumnName("institution").HasDefaultValue("");
            e.Property(x => x.MovementType).HasColumnName("movement_type").HasDefaultValue("compra");
        });

        modelBuilder.Entity<B3Asset>(e =>
        {
            e.ToTable("b3_assets");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.Ticker).HasColumnName("ticker").IsRequired();
            e.HasIndex(x => x.Ticker).IsUnique();
            e.Property(x => x.Name).HasColumnName("name");
            e.Property(x => x.AssetType).HasColumnName("assettype");
            e.Property(x => x.CreatedAt).HasColumnName("createdat");
            e.Property(x => x.LongName).HasColumnName("longname");
            e.Property(x => x.Sector).HasColumnName("sector");
            e.Property(x => x.RegularMarketPrice).HasColumnName("regularmarketprice");
            e.Property(x => x.LogoUrl).HasColumnName("logourl");
            e.Property(x => x.FiiType).HasColumnName("fiitype");
        });

        modelBuilder.Entity<AssetDividend>(e =>
        {
            e.ToTable("asset_dividends");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.AssetId).HasColumnName("assetid");
            e.Property(x => x.PaymentDate).HasColumnName("paymentdate");
            e.Property(x => x.GrossAmount).HasColumnName("grossamount");
            e.Property(x => x.NetAmount).HasColumnName("netamount");
            e.Property(x => x.Description).HasColumnName("description");
            e.Property(x => x.CreatedAt).HasColumnName("createdat");
            e.Property(x => x.ComDate).HasColumnName("comdate");
            e.Property(x => x.Type).HasColumnName("type").HasDefaultValue("dividendo");
        });

        modelBuilder.Entity<AuditLog>(e =>
        {
            e.ToTable("audit_log");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.UserId).HasColumnName("userid");
            e.Property(x => x.Username).HasColumnName("username");
            e.Property(x => x.Action).HasColumnName("action");
            e.Property(x => x.Details).HasColumnName("details");
            e.Property(x => x.CreatedAt).HasColumnName("createdat");
        });
    }
}
