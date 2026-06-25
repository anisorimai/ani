@echo off
setlocal enabledelayedexpansion

title ANI-VOXA - Dev Launcher

echo.
echo  ============================================================
echo   ANI-VOXA  ^|  Starting Development Environment
echo  ============================================================
echo.

:: ── Locate project root ──────────────────────────────────────────
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

:: ── Check Python ─────────────────────────────────────────────────
echo  [CHECK]  Verifying Python installation ...
where python >nul 2>&1
if errorlevel 1 (
    echo  [ERROR]  Python not found.
    echo           Install Python 3.10+ from https://python.org and
    echo           make sure it is added to PATH.
    pause & exit /b 1
)
for /f "tokens=2 delims= " %%V in ('python --version 2^>^&1') do set PYVER=%%V
echo  [OK]     Python %PYVER% found.

:: ── Check Node.js ────────────────────────────────────────────────
echo  [CHECK]  Verifying Node.js installation ...
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR]  Node.js not found.
    echo           Install Node.js from https://nodejs.org and
    echo           make sure it is added to PATH.
    pause & exit /b 1
)
for /f "tokens=1" %%V in ('node --version 2^>^&1') do set NODEVER=%%V
echo  [OK]     Node.js %NODEVER% found.
echo.

:: ── Sanity checks ────────────────────────────────────────────────
if not exist "%BACKEND%\main.py" (
    echo  [ERROR]  backend\main.py not found.
    echo           Run this script from the project root folder.
    pause & exit /b 1
)

if not exist "%FRONTEND%\package.json" (
    echo  [ERROR]  frontend\package.json not found.
    pause & exit /b 1
)

if not exist "%BACKEND%\.env" (
    echo  [WARN]   backend\.env not found.
    echo           Copy backend\.env.example to backend\.env and
    echo           set LLM_API_KEY and MONGO_URI before starting.
    echo.
    pause & exit /b 1
)

:: ── Install / sync Python dependencies ───────────────────────────
echo  [INFO]   Installing Python dependencies (this may take a moment) ...
pip install -r "%BACKEND%\requirements.txt" --quiet --disable-pip-version-check
if errorlevel 1 (
    echo  [ERROR]  pip install failed. Check backend\requirements.txt and your internet connection.
    pause & exit /b 1
)
echo  [OK]     Python dependencies up to date.

:: ── Install frontend deps if missing ─────────────────────────────
if not exist "%FRONTEND%\node_modules" (
    echo  [INFO]   node_modules missing — running npm install ...
    pushd "%FRONTEND%"
    call npm install
    if errorlevel 1 (
        echo  [ERROR]  npm install failed.
        popd
        pause & exit /b 1
    )
    popd
    echo  [OK]     Frontend dependencies installed.
) else (
    echo  [OK]     Frontend node_modules found.
)
echo.

echo.

:: ── Write temp launcher scripts ───────────────────────────────────
set "TMPB=%TEMP%\voxa_backend.bat"
set "TMPF=%TEMP%\voxa_frontend.bat"

(
    echo @echo off
    echo title ANI-VOXA Backend
    echo cd /d "%BACKEND%"
    echo echo.
    echo echo  ANI-VOXA Backend - http://localhost:8000
    echo echo  Press Ctrl+C to stop.
    echo echo.
    echo python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
) > "%TMPB%"

(
    echo @echo off
    echo title ANI-VOXA Frontend
    echo cd /d "%FRONTEND%"
    echo echo.
    echo echo  ANI-VOXA Frontend - http://localhost:5173
    echo echo  Press Ctrl+C to stop.
    echo echo.
    echo npm run dev
) > "%TMPF%"

:: ── Launch backend ────────────────────────────────────────────────
echo  [INFO]   Starting backend ...
start "ANI-VOXA Backend"  cmd /c "%TMPB%"

timeout /t 3 /nobreak >nul

:: ── Launch frontend ───────────────────────────────────────────────
echo  [INFO]   Starting frontend ...
start "ANI-VOXA Frontend" cmd /c "%TMPF%"

:: ── Open browser after a short delay ─────────────────────────────
echo  [INFO]   Opening browser in 5 seconds ...
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

:: ── Status monitor — stays open until Enter is pressed ───────────
:monitor
cls
echo.
echo  ============================================================
echo   ANI-VOXA  ^|  All Services Running
echo  ============================================================
echo.
echo   App       :  http://localhost:5173
echo   AI        :  http://localhost:5173/ai
echo   Backend   :  http://localhost:8000
echo   API docs  :  http://localhost:8000/docs
echo   Health    :  http://localhost:8000/api/health
echo.
echo   Python    :  %PYVER%
echo   Node.js   :  %NODEVER%
echo.
echo  ============================================================
echo.
echo   Services are running in their own windows.
echo   Press Enter here to stop everything and exit.
echo.
pause >nul
goto cleanup

:: ── Cleanup on exit ───────────────────────────────────────────────
:cleanup
echo.
echo  [INFO]   Stopping all ANI-VOXA services ...
taskkill /fi "WINDOWTITLE eq ANI-VOXA Backend*"  /t /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq ANI-VOXA Frontend*" /t /f >nul 2>&1
del "%TMPB%" >nul 2>&1
del "%TMPF%" >nul 2>&1
echo  [INFO]   Done. Goodbye.
echo.
endlocal
