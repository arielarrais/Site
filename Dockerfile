# build stage
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY api/dotnet/SiteApi.slnx .
COPY api/dotnet/SiteApi.Domain/SiteApi.Domain.csproj api/dotnet/SiteApi.Domain/
COPY api/dotnet/SiteApi.Application/SiteApi.Application.csproj api/dotnet/SiteApi.Application/
COPY api/dotnet/SiteApi.Infrastructure/SiteApi.Infrastructure.csproj api/dotnet/SiteApi.Infrastructure/
COPY api/dotnet/SiteApi/SiteApi.csproj api/dotnet/SiteApi/
RUN dotnet restore api/dotnet/SiteApi/SiteApi.csproj

COPY api/dotnet/ api/dotnet/
RUN dotnet publish api/dotnet/SiteApi/SiteApi.csproj -c Release -o /app/publish

# runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

# copy compiled site + static client
COPY --from=build /app/publish .
COPY client/ /app/client/

EXPOSE 3001
ENV ASPNETCORE_URLS=http://0.0.0.0:3001
ENTRYPOINT ["dotnet", "SiteApi.dll"]
