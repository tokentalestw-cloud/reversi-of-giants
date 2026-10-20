@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:8765
python server.py 8765
pause
