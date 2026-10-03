@echo off
rem Starts a local server (127.0.0.1:47831) in a minimized window and opens the app.
rem Close the "Spincard server" window to stop it.
cd /d "%~dp0"
start "Spincard server" /min node serve.mjs
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:47831/
