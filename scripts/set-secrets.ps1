# Sets the runtime secrets of both Workers (web + brain) for one environment.
#
#   powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1 -Target dev
#   ... -Target dev -Jira    only the Jira app's two values
#
# Each value is typed once, hidden, and sent to every Worker that needs it
# through `wrangler secret bulk` on stdin: nothing is written to disk.
# Empty answers are skipped. Run `pnpm exec wrangler login` first.
param([ValidateSet("dev", "production")][string]$Target = "dev", [switch]$Jira)
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
# Jira's OAuth 2.0 app (developer.atlassian.com > Settings): both Workers use it.
function Add-Jira {
  Add JIRA_CLIENT_ID (Read-Host "Atlassian app Client ID") -Web -Brain
  Add JIRA_CLIENT_SECRET (Read-Secret "Atlassian app Secret") -Web -Brain
}
if ($Jira) { Add-Jira } else {
  Add DATABASE_URL (Read-Secret "Supabase DATABASE_URL (Connect > Transaction pooler, port 6543)") -Web -Brain
  $anthropic = Read-Secret "Anthropic API key"
  Add ANTHROPIC_API_KEY $anthropic -Web -Brain
  # The brain's Claude agent lives in the key's Anthropic workspace.
  if ($anthropic -and (Read-Host "Create the Claude agent for '$Target' with this key? (y/N)") -eq "y") {
    $env:ANTHROPIC_API_KEY = $anthropic
    try { $out = pnpm --silent bootstrap:anthropic } finally { Remove-Item Env:ANTHROPIC_API_KEY }
    foreach ($line in $out) { if ($line -match '^(ANTHROPIC_(AGENT|ENVIRONMENT)_ID)=(.+)$') { Add $Matches[1] $Matches[3] -Brain } }
    if (-not $brainSecrets.ContainsKey("ANTHROPIC_AGENT_ID")) { throw "The Claude agent was not created: $out" }
  }
  Add OPENAI_API_KEY (Read-Secret "OpenAI API key") -Brain
  $stripeKey = if ($Target -eq "production") { "sk_live_..." } else { "sk_test_..." }
  Add STRIPE_SECRET_KEY (Read-Secret "Stripe secret key ($stripeKey)") -Web
  Add STRIPE_WEBHOOK_SECRET (Read-Secret "Stripe webhook signing secret (whsec_...)") -Web
  if ((Read-Host "Is Stripe Tax active in this Stripe account? (y/N)") -eq "y") { Add STRIPE_TAX "on" -Web }
  Add GITHUB_APP_ID (Read-Host "GitHub App ID (a number)") -Web -Brain
  Add GITHUB_APP_WEBHOOK_SECRET (Read-Secret "GitHub App webhook secret") -Web
  Add RESEND_API_KEY (Read-Secret "Resend API key (re_..., Sending access)") -Web -Brain
  Add SUPABASE_SECRET_KEY (Read-Secret "Supabase secret key (Settings > API Keys > Secret keys, sb_secret_...)") -Web
  $pem = Read-Host "Path to the GitHub App private key (.pem)"
  if ($pem) { Add GITHUB_APP_PRIVATE_KEY ((Get-Content -Raw $pem.Trim('"')).Trim()) -Web -Brain }
  # A new key makes stored tracker tokens unreadable: only on the first run.
  if ((Read-Host "Generate TOKEN_ENCRYPTION_KEY? Only on the first run (y/N)") -eq "y") {
    Add TOKEN_ENCRYPTION_KEY (node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") -Web -Brain
  }
  Add-Jira
}

if ($webSecrets.Count) { $webSecrets | ConvertTo-Json -Compress | pnpm exec wrangler secret bulk --env $Target }
if ($brainSecrets.Count) { $brainSecrets | ConvertTo-Json -Compress | pnpm exec wrangler secret bulk --config workers/wrangler.jsonc --env $Target }
Write-Host "Web: $($webSecrets.Keys -join ', ')" -ForegroundColor Green
Write-Host "Brain: $($brainSecrets.Keys -join ', ')" -ForegroundColor Green
