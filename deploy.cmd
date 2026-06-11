@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  Review Funnel -> Cloudflare Pages deploy
REM ============================================================
REM  One-shot deploy: login, create KV if needed, push vars +
REM  secrets, deploy. Reads creds from .env.secrets in this dir.
REM
REM  Usage:
REM    deploy.cmd           <- production deploy
REM    deploy.cmd preview   <- preview branch deploy
REM ============================================================

set "ROOT=%~dp0"
set "SECRETS_FILE=%ROOT%.env.secrets"
set "PROJECT_NAME=ratify"
set "KV_BINDING=RF_SETTINGS"
set "KV_NAME=ratify-settings"
set "BRANCH=main"

if /I "%1"=="preview" set "BRANCH=preview"

echo.
echo === Review Funnel deploy (branch: %BRANCH%) ===

REM ---- 1. Check secrets file ----
if not exist "%SECRETS_FILE%" (
  echo [X] .env.secrets not found. Copy .env.secrets.example to .env.secrets and fill it in.
  exit /b 1
)

echo [1/5] Reading .env.secrets ...
call :load_env "%SECRETS_FILE%"
if errorlevel 1 exit /b 1

REM ---- 2. Auth ----
echo [2/5] Checking Cloudflare auth ...
npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  echo     Not logged in — opening browser for OAuth login.
  npx wrangler login
  if errorlevel 1 (
    echo [X] Login failed.
    exit /b 1
  )
)

REM ---- 3. KV namespace (create if missing) ----
echo [3/5] Checking KV namespace %KV_NAME% ...
call :ensure_kv
if errorlevel 1 exit /b 1

REM ---- 4. Push secrets + vars ----
echo [4/5] Pushing secrets to Cloudflare Pages ...
call :push_secrets
if errorlevel 1 exit /b 1

echo     Pushing vars to wrangler.toml ...
call :write_vars_toml
if errorlevel 1 exit /b 1

REM ---- 5. Deploy ----
echo [5/5] Deploying to Cloudflare Pages ...
npx wrangler pages deploy . --project-name=%PROJECT_NAME% --branch=%BRANCH% --commit-dirty=true
if errorlevel 1 (
  echo [X] Deploy failed. Check output above.
  exit /b 1
)

echo.
echo === Done! Your site is live at: ===
echo     https://%PROJECT_NAME%.pages.dev
echo.
endlocal
exit /b 0

REM ============================================================
REM  Subroutines
REM ============================================================

:load_env
REM Loads KEY=VALUE pairs from a file. Values may be quoted.
for /f "usebackq tokens=1,* delims==" %%a in ("%~1") do (
  set "line=%%a"
  if not "!line:~0,1!"=="#" if not "%%a"=="" (
    set "key=%%a"
    set "value=%%b"
    REM Strip surrounding quotes
    set "value=!value:"=!"
    set "!key!=!value!"
  )
)
exit /b 0

:ensure_kv
npx wrangler kv namespace list >nul 2>&1
if errorlevel 1 (
  echo [X] Cannot list KV namespaces. Are you logged in?
  exit /b 1
)
for /f "usebackq tokens=*" %%i in (`npx wrangler kv namespace list 2^>nul ^| findstr /C:"\"title\""`) do (
  set "kv_line=%%i"
)
REM Simple check: if a namespace with our name already exists, reuse its id.
REM Otherwise create a new one and patch wrangler.toml.
echo     Looking for existing namespace %KV_NAME% ...
set "KV_ID="
for /f "usebackq tokens=2 delims=:" %%i in (`npx wrangler kv namespace list 2^>nul ^| findstr /C:"%KV_NAME%"`) do (
  set "KV_ID=%%i"
  set "KV_ID=!KV_ID: =!"
  set "KV_ID=!KV_ID:",=!"
  set "KV_ID=!KV_ID:"=!"
)
if defined KV_ID (
  echo     Reusing existing KV id: !KV_ID!
) else (
  echo     Creating new KV namespace ...
  for /f "usebackq tokens=2 delims=:" %%i in (`npx wrangler kv namespace create "%KV_NAME%" 2^>nul ^| findstr /C:"\"id\""`) do (
    set "KV_ID=%%i"
    set "KV_ID=!KV_ID: =!"
    set "KV_ID=!KV_ID:",=!"
    set "KV_ID=!KV_ID:"=!"
  )
  if not defined KV_ID (
    echo [X] Could not create KV namespace.
    exit /b 1
  )
  echo     Created KV id: !KV_ID!
)
exit /b 0

:push_secrets
REM Each wrangler secret put call opens a subshell pipe; feed the value via stdin.
set "SECRET_KEYS=GEMINI_API_KEY FIREBASE_PROJECT_ID FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY FIREBASE_API_KEY FIREBASE_AUTH_DOMAIN FIREBASE_STORAGE_BUCKET FIREBASE_MESSAGING_SENDER_ID FIREBASE_APP_ID AUTH_SECRET WHATSAPP_ACCESS_TOKEN WHATSAPP_PHONE_NUMBER_ID OWNER_WHATSAPP_NUMBER"
for %%K in (%SECRET_KEYS%) do (
  call set "VAL=%%K"
  call set "VAL=!%%K!"
  if defined VAL (
    echo     - %%K
    echo !VAL!| npx wrangler pages secret put %%K --project-name=%PROJECT_NAME% >nul 2>&1
    if errorlevel 1 (
      echo [X] Failed to push secret %%K
      exit /b 1
    )
  ) else (
    echo     - %%K (skipped, empty)
  )
)
exit /b 0

:write_vars_toml
REM Rewrite wrangler.toml with the current KV id. Vars are already in place.
set "TOML=%ROOT%wrangler.toml"
set "TMP=%ROOT%wrangler.toml.tmp"
if defined KV_ID (
  powershell -NoProfile -Command "(Get-Content '%TOML%') -replace 'id = \"[a-f0-9]+\"', 'id = \"%KV_ID%\"' | Set-Content '%TMP%'" >nul 2>&1
  move /y "%TMP%" "%TOML%" >nul
)
exit /b 0
