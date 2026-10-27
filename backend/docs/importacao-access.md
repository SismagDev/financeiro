# Importação pontual do Access

`POST /importacao/access` recebe os sete TXT como strings em um JSON UTF-8. Não recebe caminhos do servidor e não requer bibliotecas de upload. Limite do corpo: 12 MB.

Exige sessão autenticada com perfil global `admin`, vínculo ativo com todas as empresas informadas e cabeçalho `x-empresa-id` igual ao UUID da filial 1. Os UUIDs de destino devem ser distintos. A filial 3 é obrigatória se aparecer nos TXT (ela aparece nos arquivos fornecidos).

## Preparação do banco

Aplique a migration incremental `backend/migrations/009_desconto_acrescimo_lancamentos.sql` antes de iniciar o backend atualizado. Ela adiciona somente `desconto` e `acrescimo`, com padrão zero e validação de valor líquido não negativo. Os registros existentes conservam seus valores.

Exemplo com `DATABASE_URL` configurada no terminal e `psql` disponível, a partir da raiz do projeto:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/009_desconto_acrescimo_lancamentos.sql
```

A auditoria automatizada aplica essa migration dentro de uma transação e desfaz tudo; executá-la não instala a migration permanentemente.

## Chamada em PowerShell

Para executar diretamente a **importação definitiva**, use o script `backend/scripts/importar-access.ps1`. Ele solicita o login do administrador, lista os UUIDs das empresas, pede o mapeamento das filiais 1, 2 e 3 e salva um relatório com data e hora na pasta dos TXT. Não salva a senha e não executa simulação.

```powershell
powershell -ExecutionPolicy Bypass -File .\backend\scripts\importar-access.ps1
```

Execute a partir da raiz do projeto, com o backend rodando. Se necessário, informe `-ApiUrl 'https://seu-backend'` e/ou `-Pasta 'C:\caminho\dos\txt'`.

Os arquivos fornecidos usam Windows-1252. Leia com essa codificação e envie o JSON em UTF-8. O exemplo abaixo efetua login e **somente simula**:

```powershell
$base = 'http://localhost:3000'
$credencial = Get-Credential -Message 'E-mail e senha do administrador'
$sessao = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = @{ email = $credencial.UserName; password = $credencial.GetNetworkCredential().Password } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/auth/login" -Method Post -WebSession $sessao -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($login))

$pasta = 'C:\Users\Cliente\Documents\importacao_fluxo'
$arquivos = @{}
$nomes = @('pessoas.txt', 'bancos.txt', 'forma_pagamento.txt', 'plano_contas.txt', 'contas_a_pagar.txt', 'contas_a_receber.txt', 'recebimentos.txt')
foreach ($nome in $nomes) {
    $arquivos[$nome] = [IO.File]::ReadAllText((Join-Path $pasta $nome), [Text.Encoding]::GetEncoding(1252))
}
$pedido = @{
    filiais = @{ '1' = 'UUID-DA-FILIAL-1'; '2' = 'UUID-DA-FILIAL-2'; '3' = 'UUID-DA-FILIAL-3' }
    arquivos = $arquivos
    simular = $true
}
$json = $pedido | ConvertTo-Json -Depth 5
$resultado = Invoke-RestMethod -Uri "$base/importacao/access" -Method Post -WebSession $sessao -Headers @{ 'x-empresa-id' = $pedido.filiais['1'] } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
$resultado | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath '.\relatorio-importacao.json'
```

Após revisar o relatório e autorizar a carga, altere apenas `$pedido.simular = $false`, gere novamente `$json` e repita a requisição. Omitir `simular` equivale a `true`. A simulação retorna HTTP 200; a gravação, HTTP 201.

## Mapeamento e pendências

- `Tipo=0` em `recebimentos.txt` gera `movimentacoes` das contas a pagar; `Tipo=1` gera `recebimentos` das contas a receber. Os códigos de conta iguais nas duas origens ficam separados.
- Bancos, formas e planos usados nas contas elegíveis são cadastrados por empresa, preservando os códigos do legado em mapas de UUIDs. A identificação do banco vem de `Identificacao` (por exemplo, distingue `Henry-Itaú` de `Itaú`). Banco de código 0 é o Caixa Local e é válido.
- Clientes são cadastrados nas filiais em que possuem contas nos arquivos, inclusive quando uma conta fica pendente. Quem não possui contas nas filiais válidas é cadastrado na filial 1. Clientes sem nome não são cadastrados, mas suas contas válidas são importadas com `pessoa_id = NULL`; o cadastro ausente aparece nas pendências e a conta recebe um aviso. Outros erros de cadastro ou referências ausentes continuam deixando a conta pendente.
- Filial 0 ou vazia e baixas de contas ausentes são ignoradas, com arquivo, código e motivo no relatório.
- Contas com valor original não positivo, líquido negativo, referências inválidas, pagamento acima do líquido ou baixa em filial diferente ficam pendentes, junto com suas baixas. Baixas de valor não positivo ficam pendentes.
- Quando `Pagto_Valor` supera a soma das baixas detalhadas válidas, registre somente a diferença como “Baixa histórica”, usando `Pagto_Data`. Sem essa data ou com data inválida, a conta inteira e suas baixas ficam pendentes. Se as baixas detalhadas já cobrem o resumo, nenhuma baixa histórica é criada. Os limites do valor líquido continuam valendo.
- Cada filial que precisar de baixa histórica recebe um banco e uma forma “Baixa histórica”, ambos inativos e identificados por UUIDs reservados e determinísticos. Eles não aparecem nas listagens de cadastros (inclusive com filtro de inativos), nas consultas por ID ou nos seletores. As APIs normais recusam a alteração/exclusão desses cadastros, sua associação a novas contas/formas/baixas e a edição de baixas históricas, mesmo com UUID informado diretamente ou com tentativa de reativação. A permissão de gravar essas baixas é passada somente pelo serviço de importação, nunca pelo corpo da requisição.
- O reconhecimento dos cadastros históricos usa o schema existente; nenhuma nova migration é necessária para esta regra. As baixas continuam nos detalhes, listagem de baixas, caixa e totais, com o nome “Baixa histórica” disponível na resposta dos recebimentos e movimentações, independentemente dos cadastros ocultos.
- Se as baixas detalhadas superarem `Pagto_Valor`, mas couberem no líquido, elas são preservadas e a diferença é relatada em `avisos`. O status resulta das baixas efetivamente importadas.
- Valor original, desconto, acréscimo, vencimento, competência, documento, observações e dados cadastrais com correspondência são preservados. Datas de pagamento continuam sendo datas civis; campos sem correspondência, como `Data_Emissao`, são ignorados.
- Formas legadas inativas aceitam suas baixas durante a transação e retornam ao estado inativo antes do commit. A forma reservada “Baixa histórica” permanece inativa durante toda a importação. Nenhuma delas fica disponível para novas baixas normais.
- O banco de cada baixa é preservado pela forma de pagamento. Contas com baixas em múltiplos bancos não recebem um banco único; a situação aparece nos avisos e o caixa utiliza o banco da forma.

O retorno contém `simulado`, `filiais_encontradas`, `totais`, `ignorados`, `pendencias` e `avisos`. Pendências são excluídas da carga autorizada; a presença delas não impede a importação dos demais registros. Cada item identifica arquivo, código legado e motivo.

Em `totais`, `baixas` inclui as detalhadas e históricas; `baixas_historicas` e `valor_baixas_historicas` discriminam a parcela reconstruída. `contas_sem_cliente` conta as contas válidas importadas sem vínculo por falta do nome do cliente. Uma pendência em `pessoas.txt` por nome vazio exclui apenas o cadastro; o aviso da respectiva conta confirma sua importação sem vínculo.

Toda gravação ocorre em uma única transação, reutilizando os serviços de pessoas, contas e baixas. Uma falha de persistência reverte a carga inteira. UUIDs determinísticos e bloqueios por empresa impedem duplicações de uma segunda execução ou de requisições concorrentes. Registros existentes não são substituídos; se houver registros desta importação no destino, a requisição retorna HTTP 409.

## Verificação

Em `backend`: `npm test`, `npm run build` e `npx tsx tests/importacao.audit.ts`. A auditoria utiliza apenas fixtures e reverte tanto os registros quanto a migration. Em `frontend`: `npm run lint` e `npm run build`.

Com o frontend local em execução, `npx tsx tests/launch-values-ui.audit.ts` em `backend` verifica listagem líquida, detalhes, edição dos ajustes, payload e layout móvel com API simulada. A URL padrão é `http://127.0.0.1:5174`; configure `AUDIT_FRONTEND_URL` se necessário.
