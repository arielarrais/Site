using Microsoft.EntityFrameworkCore;
using SiteApi.Models;

namespace SiteApi.Data;

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
            e.Property(x => x.Userid).HasColumnName("userid");
            e.Property(x => x.Ticker).HasColumnName("ticker");
            e.Property(x => x.Quantity).HasColumnName("quantity");
            e.Property(x => x.Purchaseprice).HasColumnName("purchaseprice");
            e.Property(x => x.Purchasedat).HasColumnName("purchasedat");
            e.Property(x => x.Institution).HasColumnName("institution").HasDefaultValue("");
            e.Property(x => x.Movement_type).HasColumnName("movement_type").HasDefaultValue("compra");
        });

        modelBuilder.Entity<B3Asset>(e =>
        {
            e.ToTable("b3_assets");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.Ticker).HasColumnName("ticker").IsRequired();
            e.HasIndex(x => x.Ticker).IsUnique();
            e.Property(x => x.Name).HasColumnName("name");
            e.Property(x => x.Assettype).HasColumnName("assettype");
            e.Property(x => x.Createdat).HasColumnName("createdat");
            e.Property(x => x.Longname).HasColumnName("longname");
            e.Property(x => x.Sector).HasColumnName("sector");
            e.Property(x => x.Regularmarketprice).HasColumnName("regularmarketprice");
            e.Property(x => x.Logourl).HasColumnName("logourl");
            e.Property(x => x.Fiitype).HasColumnName("fiitype");
        });

        modelBuilder.Entity<AssetDividend>(e =>
        {
            e.ToTable("asset_dividends");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.Assetid).HasColumnName("assetid");
            e.Property(x => x.Paymentdate).HasColumnName("paymentdate");
            e.Property(x => x.Grossamount).HasColumnName("grossamount");
            e.Property(x => x.Netamount).HasColumnName("netamount");
            e.Property(x => x.Description).HasColumnName("description");
            e.Property(x => x.Createdat).HasColumnName("createdat");
            e.Property(x => x.Comdate).HasColumnName("comdate");
            e.Property(x => x.Type).HasColumnName("type").HasDefaultValue("dividendo");
        });

        modelBuilder.Entity<AuditLog>(e =>
        {
            e.ToTable("audit_log");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            e.Property(x => x.Userid).HasColumnName("userid");
            e.Property(x => x.Username).HasColumnName("username");
            e.Property(x => x.Action).HasColumnName("action");
            e.Property(x => x.Details).HasColumnName("details");
            e.Property(x => x.Createdat).HasColumnName("createdat");
        });
    }
}
