@echo off
setlocal
title Deploy SiteApi

cd /d "%~dp0"

echo ============================================
echo  Deploy do Site - rebuild + restart
echo ============================================
echo.

rem Segredos: o .env e a unica fonte e nunca entra no git
if not exist ".env" (
    echo.
    echo [ERRO] Arquivo .env nao encontrado.
    echo Copie .env.example para .env e preencha os segredos:
    echo     copy .env.example .env
    echo Depois gere o segredo do JWT:
    echo     powershell -NoProfile -File scripts\gerar-jwt-secret.ps1 -Aplicar
    echo.
    pause
    exit /b 1
)

rem Garante que o Docker Desktop esteja rodando
tasklist /fi "imagename eq Docker Desktop.exe" 2>nul | find /i "Docker Desktop.exe" >nul
if errorlevel 1 (
    echo Iniciando Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo Aguardando Docker iniciar...
    timeout /t 20 /nobreak >nul
)

echo.
echo Construindo e subindo os containers...
docker compose up -d --build web

if errorlevel 1 (
    echo.
    echo [ERRO] Falha no deploy. Veja a mensagem acima.
    pause
    exit /b 1
)

echo.
echo Site atualizado com sucesso!
echo Acesse: http://localhost:3001
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ip-externa.ps1"
echo.
pause
