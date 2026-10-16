param([switch]$Silencioso)

$ErrorActionPreference = 'Stop'

function Escrever($msg, $cor = 'Gray') {
    if (-not $Silencioso) { Write-Host $msg -ForegroundColor $cor }
}

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
    Escrever "[ERRO] .env nao encontrado em $envFile" 'Red'
    exit 1
}

$dominio = ''
$token = ''
foreach ($linha in Get-Content -LiteralPath $envFile) {
    if ($linha -match '^\s*DUCKDNS_DOMAIN\s*=\s*(.*)$') { $dominio = $Matches[1].Trim().Trim('"').Trim("'") }
    elseif ($linha -match '^\s*DUCKDNS_TOKEN\s*=\s*(.*)$') { $token = $Matches[1].Trim().Trim('"').Trim("'") }
}

if (-not $dominio -or -not $token) {
    Escrever '[ERRO] defina DUCKDNS_DOMAIN e DUCKDNS_TOKEN no .env' 'Red'
    Escrever '  1) Crie a conta em https://www.duckdns.org (entrada unica, email e senha)'
    Escrever '  2) Copie o TOKEN da pagina inicial e escolha um subdominio, por exemplo "carteira"'
    Escrever '  3) No .env acrescente:  DUCKDNS_DOMAIN=carteira'
    Escrever '                         DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
    exit 1
}

$ip = $null
foreach ($url in @('https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com')) {
    try {
        $ip = (Invoke-RestMethod -Uri $url -TimeoutSec 8).Trim()
        if ($ip) { break }
    } catch { }
}

if (-not $ip) {
    Escrever '[ERRO] nao foi possivel consultar o IP publico (sem internet?)' 'Red'
    exit 1
}

$uri = 'https://www.duckdns.org/update?domains={0}&token={1}&ip={2}' -f `
    [uri]::EscapeDataString($dominio), [uri]::EscapeDataString($token), [uri]::EscapeDataString($ip)

try {
    $resposta = (Invoke-RestMethod -Uri $uri -TimeoutSec 15).Trim()
} catch {
    Escrever ('[ERRO] falha ao falar com o DuckDNS: ' + $_.Exception.Message) 'Red'
    exit 1
}

if ($resposta -like 'OK*') {
    Escrever ''
    Escrever '  DuckDNS atualizado.' -ForegroundColor Green
    Escrever ("  IP publico     : {0}" -f $ip)
    Escrever ("  Link externo   : http://{0}.duckdns.org:3001" -f $dominio) -ForegroundColor Green
    Escrever ''
    exit 0
}

Escrever ('[ERRO] o DuckDNS recusou a atualizacao: ' + $resposta) 'Red'
Escrever '  Verifique DUCKDNS_DOMAIN e DUCKDNS_TOKEN no .env.' 'Red'
exit 1