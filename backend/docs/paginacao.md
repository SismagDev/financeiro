# Listagens e carregamento sob demanda

As telas usam os endpoints existentes com `pagina` (a partir de 1), `tamanho`
(1 a 100; interface: 50), `busca`, `ordem` e `direcao` (`asc`/`desc`).
A resposta mantém `data` e acrescenta `meta` com `total`, `pagina` efetiva e
`paginas`. Contas incluem `pagar` e `receber`; pessoas incluem `sem_vinculo`.
Esses indicadores consideram o conjunto completo filtrado.
Uma página removida por exclusão é ajustada pelo backend no mesmo request.
Consultas legadas sem `pagina`/`tamanho` continuam sem limite para preservar
os consumidores existentes. As telas e os seletores sempre enviam paginação.

- `data_inicial`/`data_final`: período inclusivo de vencimento em contas e da
  data da baixa em movimentações/recebimentos. Caixa também aceita os aliases
  anteriores `de`/`ate` e preserva o fallback para a data de criação.
- `empresas`: UUIDs separados por vírgula, autorizados em conjunto pelo middleware
  existente. `x-empresa-id` continua obrigatório. Qualquer empresa sem acesso
  rejeita a consulta completa. Escritas continuam usando a empresa do registro.
- Contas: `mostrar_em_aberto`, `mostrar_pagos`, `tipo`, `forma_pagamento_id`.
- Pessoas: `mostrar_clientes`, `mostrar_fornecedores`, com busca também por
  documento/celular sem formatação. Ambos marcados preservam os legados sem vínculo.
- Baixas: `/movimentacoes?unificadas=true` reúne as duas origens antes de ordenar
  e paginar; aceita `mostrar_recebimentos` e `mostrar_pagamentos`. Os endpoints
  individuais e o filtro `lancamento_id` continuam disponíveis.
- Caixa calcula o acumulado antes do limite da página; `saldo_atual` permanece
  o saldo de todo o conjunto. O saldo inicial editável não dispara nova consulta.
- `/lancamentos?resumo=dashboard` retorna indicadores, fluxo mensal agregado e
  uma lista curta de contas. `resumo=alertas` retorna somente a contagem de
  vencidas e até cinco notificações necessárias à navegação global.
- Seletores consultam opções ao abrir/digitar, com `opcoes=true`; descrições
  usam `opcoes=descricoes`, sem repetir a mesma descrição. “Carregar mais opções”
  permite alcançar resultados posteriores. Não dependem da página da listagem.

A navegação carrega apenas a tela ativa. Uma mutação recarrega a listagem ativa;
alterações financeiras também atualizam os alertas e, quando aberto, o detalhe
da conta. Não há recarga de todos os cadastros. Respostas antigas são descartadas;
as consultas da listagem são canceladas quando substituídas.

## Índices

`010_indices_listagens.sql` acrescenta índices para empresa/vencimento e
empresa/conta/data das duas origens de baixa. Aplicar pelo fluxo habitual de
migrations. A implementação não aplica migrations automaticamente.

## Verificação reproduzível

Na pasta `backend`, executar `npm exec -- tsx tests/pagination.audit.ts`.
Definir `PAGINATION_UI=1` para também testar os requests no Chromium headless
(usa Vite na porta 5177 e a API real da auditoria em porta temporária).
Definir `PAGINATION_PERF=1` para comparar planos com 6.000 contas e 36.000 baixas
sintéticas em tabelas temporárias com os índices atuais e propostos.

A auditoria HTTP usa PostgreSQL real, cria fixtures em transação e executa
`ROLLBACK` ao finalizar. As medições sintéticas não representam uma garantia
de latência em produção. Estatísticas e índices dos dados reais são preservados.
