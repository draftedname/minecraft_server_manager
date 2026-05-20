@echo off
setlocal enabledelayedexpansion
title MC Server GUI

echo ====================================================
echo   MC Server GUI - Setup & Launch
echo ====================================================
echo.

:: Check Node.js
echo [1/4] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please download and install Node.js from https://nodejs.org
    echo Then re-run this script.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo        Found Node.js %NODE_VER%

:: Check pnpm, install if missing
echo [2/4] Checking pnpm...
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo        pnpm not found. Installing...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install pnpm.
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('pnpm -v') do set PNPM_VER=%%i
echo        Found pnpm %PNPM_VER%

:: Check Java
echo [3/4] Checking Java...
where java >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Java is not installed or not in PATH.
    echo        Minecraft servers need Java to run.
    echo        Download Java JDK 17+ from https://adoptium.net
    echo        The web interface will still work without it.
) else (
    for /f "tokens=*" %%i in ('java -version 2^>^&1 ^| findstr /i "version"') do set JAVA_VER=%%i
    echo        Found !JAVA_VER!
)

:: Install dependencies and launch
echo [4/4] Installing project dependencies...
call pnpm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo ====================================================
echo   Starting MC Server GUI...
echo ====================================================
echo.
echo   Website:  http://localhost:5173
echo   Backend:  http://localhost:3456
echo.
echo   Press Ctrl+C to stop
echo ====================================================
echo.

call pnpm dev

pause
