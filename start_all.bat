@echo off
setlocal enabledelayedexpansion

rem Start Flask backend and serve frontend in one go.
rem Assumes:
rem - backend/app.py is the Flask entrypoint
rem - frontend/index.html can be served as static content
rem - Python is available on PATH

set BACKEND_PORT=5000
set FRONTEND_PORT=5500

echo Starting backend (Flask) ...
start "backend" /b python backend/app.py

echo Waiting for backend to be ready on http://127.0.0.1:%BACKEND_PORT%/health ...

set /a i=0
:wait_loop
set /a i+=1

python -c "import time,urllib.request; t=0
for _ in range(1):
  t+=1
  try:
    urllib.request.urlopen('http://127.0.0.1:%BACKEND_PORT%/health', timeout=1).read()
    print('backend ready')
    raise SystemExit(0)
  except Exception as e:
    pass
" >nul 2>&1
if not errorlevel 1 (
  goto frontend
)

if !i! geq 30 goto frontend
timeout /t 1 >nul
goto wait_loop

:frontend
echo Starting frontend static server ...
start "frontend" /b python -m http.server %FRONTEND_PORT% --directory frontend

echo.
echo Started.
echo Backend:   http://127.0.0.1:%BACKEND_PORT%/health
echo Frontend: http://127.0.0.1:%FRONTEND_PORT%/index.html
echo.

rem Keep the .bat alive
pause

