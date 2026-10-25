# Sets the runtime secrets of both Workers (web + brain) for one environment.
#
#   powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1 -Target dev
#
# Each value is typed once, hidden, and sent to every Worker that needs it
# through `wrangler secret bulk` on stdin: nothing is written to disk.
# Empty answers are skipped. Run `pnpm exec wrangler login` first.
param([ValidateSet("dev", "production")][string]$Target = "dev")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Read-Secret($label) {
  $secure = Read-Host -AsSecureString $label
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$webSecrets = @{}; $brainSecrets = @{}
function Add($name, $value, [switch]$Web, [switch]$Brain) {
  if (-not $value) { return }
  if ($Web) { $webSecrets[$name] = $value }
  if ($Brain) { $brainSecrets[$name] = $value }
}

Write-Host "Secrets for '$Target'. Leave a value empty to skip it." -ForegroundColor Yellow
Add DATABASE_URL (Read-Secret "Supabase DATABASE_URL (Connect > Transaction pooler, port 6543)") -Web -Brain
Add ANTHROPIC_API_KEY (Read-Secret "Anthropic API key") -Web -Brain
Add OPENAI_API_KEY (Read-Secret "OpenAI API key") -Brain
Add STRIPE_SECRET_KEY (Read-Secret "Stripe secret key (sk_test_...)") -Web
Add STRIPE_WEBHOOK_SECRET (Read-Secret "Stripe webhook signing secret (whsec_...)") -Web
Add GITHUB_APP_ID (Read-Host "GitHub App ID (a number)") -Web -Brain
Add GITHUB_APP_WEBHOOK_SECRET (Read-Secret "GitHub App webhook secret") -Web
Add RESEND_API_KEY (Read-Secret "Resend API key (re_..., Sending access)") -Web
Add SUPABASE_SECRET_KEY (Read-Secret "Supabase secret key (Settings > API Keys > Secret keys, sb_secret_...)") -Web
$pem = Read-Host "Path to the GitHub App private key (.pem)"
if ($pem) { Add GITHUB_APP_PRIVATE_KEY ((Get-Content -Raw $pem.Trim('"')).Trim()) -Web -Brain }
# A new key makes stored tracker tokens unreadable: only on the first run.
if ((Read-Host "Generate TOKEN_ENCRYPTION_KEY? Only on the first run (y/N)") -eq "y") {
  Add TOKEN_ENCRYPTION_KEY (node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") -Web -Brain
}

if ($webSecrets.Count) { $webSecrets | ConvertTo-Json -Compress | pnpm exec wrangler secret bulk --env $Target }
if ($brainSecrets.Count) { $brainSecrets | ConvertTo-Json -Compress | pnpm exec wrangler secret bulk --config workers/wrangler.jsonc --env $Target }
Write-Host "Web: $($webSecrets.Keys -join ', ')" -ForegroundColor Green
Write-Host "Brain: $($brainSecrets.Keys -join ', ')" -ForegroundColor Green
Write-Host "Next: ANTHROPIC_AGENT_ID and ANTHROPIC_ENVIRONMENT_ID, from pnpm bootstrap:anthropic." -ForegroundColor Yellow
