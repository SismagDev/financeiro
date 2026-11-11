# Importação temporária de Caixa Diário

Na tela **Contas**, use **Importar caixa diário**, à esquerda de **Caixa Diário**.
Selecione o TXT e informe a data inicial. A leitura aceita UTF-8 e Windows-1252.
Mapeie cada filial para uma empresa, seu tipo de caixa e quatro formas de pagamento distintas, identificadas pelo banco e descrição.

A prévia usa `Rec_Dinheiro + Valor_Sangria − Valor_Suprimento`, `Rec_Cartão`, `Rec_Banco` e `Rec_Outros`.
Campos vazios valem zero. Quando todos os recebimentos originais são vazios ou zero, o valor é Receita_Service + Receita_Zaal − Despesas e a conta é quitada com uma única Baixa histórica, usando os cadastros reservados por empresa. Nesse caso, não são exigidas formas comuns e sangria, suprimento e equipamentos não entram no cálculo. A prévia mostra a fórmula e o resultado. Resultados zero não são gravados; negativos deixam o dia pendente. Nos demais dias, receitas brutas, compras e despesas não geram movimentos nem complementam recebimentos parciais.
Dias zerados não são gravados. Qualquer recebimento negativo deixa **o dia inteiro pendente**.
Na lista, escolha não importar o dia ou abra **Fazer manualmente**. O formulário existente recebe apenas as baixas positivas e permite revisar o total e completar as baixas.
Cancelar ou fechar esse formulário retorna à prévia; falhas mantêm o dia pendente. Somente a gravação bem-sucedida remove a pendência.

As configurações ficam bloqueadas após a primeira resolução manual ou a carga automática, para preservar os vínculos dos dias já gravados.
O estado fica na sessão do modal: fechar o modal de importação ou recarregar a página encerra essa sessão.

O endpoint `POST /importacao/caixa-diario` oferece `analisar`, `prever`, `importar` e `manual`, com as mesmas permissões de escrita do Caixa Diário.
Todas as empresas de destino precisam pertencer ao usuário e estar disponíveis segundo as regras de licença existentes.
Prévia e confirmação verificam conflitos por empresa/data; dias existentes são listados e ignorados, inclusive quando surgem entre a prévia e a confirmação. Os demais dias elegíveis são importados normalmente.
Dias resolvidos nesta sessão são verificados pelo UUID determinístico e não entram na carga automática.
Há bloqueio por empresa, revalidação antes da escrita e uma transação para toda a carga automática. Esta correção não exige alteração de schema.

## Verificação

Em `backend`:

- `npm test`: testes de regras e concorrência com driver em memória.
- Com `DAILY_CASH_TXT` apontando para o TXT real, `npm test` também confere o arquivo em memória, sem gravá-lo no banco.
- `npx tsx tests/daily-cash-import.audit.ts`: SQL/HTTP com fixtures sintéticas e rollback externo.
- `npx tsx tests/daily-cash.audit.ts`: regressão do Caixa Diário existente, com rollback externo.
- Com frontend local, `npx tsx tests/daily-cash-import-ui.audit.ts`: fluxo de interface com API simulada; `AUDIT_FRONTEND_URL` permite alterar a URL padrão `http://127.0.0.1:5189`.

As auditorias não executam a carga real do TXT.

## Sistemas

O TXT é analisado por Sistema, em etapas com mapeamentos e pendências independentes. A descrição da forma e o banco são mostrados em duas colunas, ordenados nessa ordem.

O plano de contas recebe o nome do Sistema e é criado por empresa se não existir. A identificação e os UUIDs usam empresa, data e UUID do plano. A prévia reverte também a criação do plano; a confirmação grava tudo na mesma transação.

O fluxo não lê nem grava sistema_importacao_caixa. O arquivo da migration 016 foi removido; a estrutura já aplicada no banco permanece intacta. Cargas antigas são reconhecidas pelos UUIDs anteriores e observações/tipo disponíveis; o plano antigo não é reclassificado e a prévia avisa quando ele foi preservado. Se a origem legada foi alterada e não puder ser reconhecida, confira os registros antes de reimportar.
