param(
    [int]$Minutos = 5,
    [switch]$Remover
)

$ErrorActionPreference = 'Stop'

$nome = 'Site-Atualizar-DDNS'
$script = Join-Path $PSScriptRoot 'atualizar-ddns.ps1'

Write-Host ''
Write-Host '  TAREFA AGENDADA DO DDNS' -ForegroundColor Cyan
Write-Host '  -------------------------'
Write-Host ''

if ($Remover) {
    if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $nome -Confirm:$false
        Write-Host "  Tarefa '$nome' removida." -ForegroundColor Yellow
    } else {
        Write-Host "  A tarefa '$nome' nao existe." -ForegroundColor Yellow
    }
    Write-Host ''
    exit 0
}

if (-not (Test-Path -LiteralPath $script)) {
    Write-Host "[ERRO] script nao encontrado: $script" -ForegroundColor Red
    exit 1
}

$acao = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Silencioso' -f $script)

$gatilho = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $Minutos) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

Register-ScheduledTask `
    -TaskName $nome `
    -Action $acao `
    -Trigger $gatilho `
    -Description 'Atualiza o IP publico no DuckDNS para o endereco do site nunca mudar.' `
    -Force | Out-Null

Write-Host ("  Tarefa '{0}' criada: roda a cada {1} minutos." -f $nome, $Minutos) -ForegroundColor Green
Write-Host '  Ela roda so com o Windows ligado e com a internet ativa.'
Write-Host ''
Write-Host '  Testar agora:  powershell -NoProfile -File scripts/atualizar-ddns.ps1'
Write-Host '  Desinstalar:   powershell -NoProfile -File scripts/instalar-tarefa-ddns.ps1 -Remover'
Write-Host ''

& $script
exit $LASTEXITCODE