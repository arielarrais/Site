param([int]$Porta = 3001)

$ErrorActionPreference = 'SilentlyContinue'

$local = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -eq 'Dhcp' } |
    Select-Object -First 1

Write-Host ''
Write-Host '  ACESSO AO SITE' -ForegroundColor Cyan
Write-Host '  --------------'

if ($local) {
    Write-Host ("  Na rede local : http://{0}:{1}" -f $local.IPAddress, $Porta)
}

$public = $null
foreach ($url in @('https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com')) {
    try {
        $public = (Invoke-RestMethod -Uri $url -TimeoutSec 8).Trim()
        if ($public) { break }
    } catch { }
}

if ($public) {
    Write-Host ("  IP externo    : http://{0}:{1}" -f $public, $Porta) -ForegroundColor Green
    Write-Host ''
    Write-Host '  Se o link acima nao abrir de fora da sua casa, no roteador configure:'
    Write-Host ("    redirecionamento de porta {0} -> {1}:{0} (TCP)" -f $Porta, $(if ($local) { $local.IPAddress } else { 'IP-DA-MAQUINA' }))
    Write-Host ' Seu IP externo e dinamico: quando a operadora trocar, o link muda.'
} else {
    Write-Host '  IP externo    : nao foi possivel consultar (sem internet?)' -ForegroundColor Yellow
}

$resp = Test-NetConnection -ComputerName 'localhost' -Port $Porta -WarningAction SilentlyContinue
if ($resp.TcpTestSucceeded) {
    Write-Host ''
    Write-Host "  Porta $Porta respondendo localmente. OK." -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host "  Porta $Porta NAO responde localmente. Rode: docker compose up -d" -ForegroundColor Red
}
