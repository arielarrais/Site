param([switch]$Aplicar)

$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)

Write-Host ''
Write-Host "JWT_SECRET=$secret"
Write-Host ''

if (-not $Aplicar) {
    Write-Host 'Copie a linha acima para o JWT_SECRET no arquivo .env.'
    Write-Host 'Para gerar e gravar de uma vez:  .\scripts\gerar-jwt-secret.ps1 -Aplicar'
    Write-Host 'Trocar o segredo desloga todos os usuarios.'
    exit 0
}

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Host "[ERRO] .env nao encontrado em $envFile" -ForegroundColor Red
    exit 1
}

$content = Get-Content -LiteralPath $envFile
$updated = $content | ForEach-Object {
    if ($_ -match '^JWT_SECRET=') { "JWT_SECRET=$secret" } else { $_ }
}
if (-not ($content -match '^JWT_SECRET=')) {
    $updated += "JWT_SECRET=$secret"
}
Set-Content -LiteralPath $envFile -Value $updated -Encoding UTF8

Write-Host "JWT_SECRET atualizado no .env." -ForegroundColor Green
Write-Host 'Reinicie a aplicacao:  docker compose up -d --force-recreate web'
