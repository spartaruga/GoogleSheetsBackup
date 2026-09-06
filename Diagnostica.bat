@echo off
cd /d "%~dp0"
set "GWB_NODE=%~dp0runtime\node.exe"
set "GWB_APP=%~dp0app"
if not exist "%GWB_APP%\package.json" set "GWB_APP=%~dp0"
if not exist "%GWB_NODE%" set "GWB_NODE=node.exe"
echo GOOGLE WORKSPACE BACKUP - DIAGNOSTICA LOCALE
"%GWB_NODE%" --version
"%GWB_NODE%" "%GWB_APP%\engine.mjs" self-test
if errorlevel 1 echo ERRORE: controlla runtime e componenti. Consulta README.md.
echo Log in %%APPDATA%%\GoogleWorkspaceBackup
pause
