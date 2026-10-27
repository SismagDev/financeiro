# Executa a importacao DEFINITIVA. O backend deve estar em execucao.
[CmdletBinding()]
param(
    [string]$ApiUrl = 'http://localhost:3000',
    [string]$Pasta = 'C:\Users\Cliente\Documents\importacao_fluxo'
)

$ErrorActionPreference = 'Stop'
$ApiUrl = $ApiUrl.TrimEnd('/')
$nomes = @(
    'pessoas.txt', 'bancos.txt', 'forma_pagamento.txt', 'plano_contas.txt',
    'contas_a_pagar.txt', 'contas_a_receber.txt', 'recebimentos.txt'
)
$arquivos = @{}
foreach ($nome in $nomes) {
    $caminho = Join-Path $Pasta $nome
    if (-not (Test-Path -LiteralPath $caminho -PathType Leaf)) {
        throw "Arquivo nao encontrado: $caminho"
    }
    $arquivos[$nome] = [IO.File]::ReadAllText($caminho, [Text.Encoding]::GetEncoding(1252))
}

$credencial = Get-Credential -Message 'Informe o e-mail e a senha do administrador'
if ($null -eq $credencial) { throw 'Login cancelado.' }
$sessao = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = @{
    email = $credencial.UserName
    password = $credencial.GetNetworkCredential().Password
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$ApiUrl/auth/login" -Method Post -WebSession $sessao `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($login)) -TimeoutSec 60 | Out-Null
} finally {
    $login = $null
    $credencial = $null
}

$empresas = @((Invoke-RestMethod -Uri "$ApiUrl/empresas" -WebSession $sessao -TimeoutSec 60).data)
Write-Host "`nEmpresas disponiveis:"
$empresas | Select-Object nome, id | Format-Table -AutoSize | Out-Host

$filiais = @{}
foreach ($codigo in @('1', '2', '3')) {
    do {
        $informado = (Read-Host "UUID da empresa correspondente a filial legada $codigo").Trim()
        $uuid = [guid]::Empty
        $valido = [guid]::TryParse($informado, [ref]$uuid)
        if ($valido) {
            $informado = $uuid.ToString()
            $valido = @($empresas | Where-Object { $_.id -eq $informado }).Count -gt 0 -and
                @($filiais.Values | Where-Object { $_ -eq $informado }).Count -eq 0
        }
        if (-not $valido) { Write-Host 'Informe um UUID da lista, diferente das filiais ja escolhidas.' -ForegroundColor Yellow }
    } until ($valido)
    $filiais[$codigo] = $informado
}

$pedido = @{ filiais = $filiais; arquivos = $arquivos; simular = $false }
$json = $pedido | ConvertTo-Json -Depth 5
Write-Host "`nExecutando a importacao definitiva. Aguarde..."
$resultado = Invoke-RestMethod -Uri "$ApiUrl/importacao/access" -Method Post -WebSession $sessao `
    -Headers @{ 'x-empresa-id' = $filiais['1'] } `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 600

$relatorio = Join-Path $Pasta ('relatorio-importacao-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$resultado | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $relatorio -Encoding UTF8
$resultado.totais | Format-List | Out-Host
Write-Host "Relatorio salvo em: $relatorio" -ForegroundColor Green
