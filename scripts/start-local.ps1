# Executar na raiz do repositório: powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
# Não altera a base de dados, não publica e não executa migrations.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js não encontrado. Instale Node.js 22 LTS ou superior.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm não encontrado. Instale Node.js com npm.' }
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw 'Node.js 20 ou superior é necessário; recomendado Node.js 22 LTS.' }
if (-not (Test-Path 'node_modules')) {
  Write-Host 'Instalando dependências bloqueadas (npm ci)...'
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' }
}
if (-not (Test-Path '.env.local')) {
  @'
# Preview público sem backend: deixe as duas variáveis abaixo vazias.
# Para login admin real, preencha URL e chave PUBLICÁVEL anon do Supabase.
# Nunca utilize service_role, secret keys nem palavras-passe neste ficheiro.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_ROUTER_MODE=hash
'@ | Set-Content -Path '.env.local' -Encoding UTF8
  Write-Host 'Criado .env.local em modo preview sem backend.'
}
Write-Host ''
Write-Host 'SITE:        http://127.0.0.1:8080/#/pt/'
Write-Host 'ADMIN LOGIN: http://127.0.0.1:8080/#/admin/login'
Write-Host 'ADMIN:       http://127.0.0.1:8080/#/admin'
Write-Host 'Nota: o admin exige URL + anon key do Supabase e conta admin autorizada.'
Write-Host 'Para parar: Ctrl+C nesta janela.'
Write-Host ''
Start-Process 'http://127.0.0.1:8080/#/pt/'
npm run dev -- --host 127.0.0.1 --port 8080 --strictPort
if ($LASTEXITCODE -ne 0) { throw 'Servidor local não iniciou.' }
