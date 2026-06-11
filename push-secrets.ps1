#!/usr/bin/env pwsh
# Push secrets from .env.secrets to Cloudflare Pages project "ratify".
# Reads KEY=VALUE pairs, strips surrounding quotes, pipes each value to wrangler.

$ErrorActionPreference = "Stop"
$envFile = "C:\Users\paras\Desktop\Workspace\review-funnel-master\.env.secrets"
$project = "ratify"

if (-not (Test-Path $envFile)) {
    Write-Error "Env file not found: $envFile"
    exit 1
}

# Keys to push. Order doesn't matter.
$keys = @(
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "GEMINI_API_KEY",
    "AUTH_SECRET"
)

$envMap = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $eqIdx = $line.IndexOf("=")
    if ($eqIdx -lt 0) { return }
    $k = $line.Substring(0, $eqIdx).Trim()
    $v = $line.Substring($eqIdx + 1).Trim()
    # Strip surrounding double quotes if present
    if ($v.StartsWith('"') -and $v.EndsWith('"')) {
        $v = $v.Substring(1, $v.Length - 2)
    }
    $envMap[$k] = $v
}

$failures = @()
foreach ($k in $keys) {
    if (-not $envMap.ContainsKey($k)) {
        Write-Warning "[skip] $k not in .env.secrets"
        continue
    }
    $v = $envMap[$k]
    if ([string]::IsNullOrWhiteSpace($v)) {
        Write-Warning "[skip] $k is empty"
        continue
    }
    Write-Host "[push] $k (length: $($v.Length))"
    $v | npx --yes wrangler@latest pages secret put $k --project-name=$project 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[fail] $k"
        $failures += $k
    } else {
        Write-Host "  -> ok"
    }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Error "Failed secrets: $($failures -join ', ')"
    exit 1
}
Write-Host ""
Write-Host "All secrets pushed."
