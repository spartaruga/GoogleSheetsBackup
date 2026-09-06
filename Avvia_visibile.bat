@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0launcher.ps1" -Visible
if errorlevel 1 (
  echo.
  echo AVVIO NON RIUSCITO. Leggi il messaggio sopra.
  pause
)
