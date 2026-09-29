# Instruções do projeto

## Princípios gerais

- Faça apenas as alterações necessárias para atender à solicitação.
- Preserve a arquitetura, padrões e convenções existentes no projeto.
- Antes de criar uma nova implementação, verifique se já existe lógica, componente, service, utilitário, hook ou endpoint que possa ser reutilizado.
- Reutilize a lógica existente em vez de criar fluxos paralelos.
- Não refatore código fora do escopo da tarefa.
- Não faça alterações "aproveitando a oportunidade" sem necessidade para a solicitação atual.
- Prefira a solução mais simples que seja consistente com a arquitetura existente.
- Evite abstrações, camadas e generalizações desnecessárias.
- Não altere contratos, comportamentos ou interfaces existentes sem necessidade.
- Quando uma alteração puder ser feita localmente, não a espalhe por outras partes do projeto.
- Não produza análises extensas antes de implementar. Inspecione o necessário e execute a tarefa de forma objetiva.

## Stack

- Backend: Node.js + Express + TypeScript
- Frontend: React + TypeScript
- Banco: PostgreSQL
- Validação: Zod

## Backend

- Controllers não devem acessar o PostgreSQL diretamente.
- Regras de negócio devem ficar nos services.
- Queries SQL devem seguir o padrão existente no projeto.
- Dados recebidos pela API devem ser validados com Zod.
- Erros de validação devem usar `formatarErroZod`.
- Não utilizar `any` sem justificativa.
- Antes de criar um novo endpoint ou service, verifique se o comportamento pode ser incorporado a um já existente.
- Não duplique regras de negócio existentes.
- Alterações em uma funcionalidade devem reutilizar o fluxo existente sempre que possível.

## Banco de dados

- IDs utilizam UUID.
- Datas devem utilizar `TIMESTAMPTZ`.
- Preserve todos os dados existentes.
- Não executar `DROP`, `TRUNCATE`, recriação de tabelas ou outras operações destrutivas sem solicitação explícita.
- Alterações de schema devem ser incrementais e compatíveis com os dados existentes.
- Não remover colunas, constraints ou registros apenas porque deixaram de ser utilizados por uma tela.
- Não criar ou alterar estruturas do banco se a funcionalidade puder ser implementada corretamente sem isso.

## API

- Rotas protegidas devem utilizar o middleware de autenticação existente.
- Não criar mecanismos paralelos de autenticação.
- Manter o padrão atual de respostas HTTP.
- Reutilizar endpoints existentes quando isso não prejudicar a semântica da API.
- Não criar novas rotas quando uma pequena extensão de uma rota existente resolver corretamente a necessidade.
- Preserve compatibilidade com consumidores existentes da API sempre que possível.

## Frontend

- Utilizar os componentes e padrões já existentes.
- Não introduzir bibliotecas de UI sem necessidade.
- Não duplicar lógica que já exista em componentes, hooks ou utilitários.
- Reutilizar componentes existentes antes de criar novos.
- Manter consistência visual com as telas existentes.
- Não redesenhar telas ou componentes fora do escopo solicitado.
- Alterações locais devem permanecer locais sempre que possível.
- Não criar estados, hooks ou abstrações adicionais quando a estrutura existente for suficiente.

## Escopo das alterações

- Respeite estritamente o escopo solicitado.
- Modifique somente os arquivos necessários.
- Se a solicitação mencionar uma tela específica, não altere outras telas sem necessidade técnica.
- Se uma mudança exigir alterações indiretas em backend, frontend ou banco, faça somente o mínimo necessário.
- Não altere funcionalidades que já funcionam corretamente apenas para padronização ou preferência pessoal.
- Não substitua implementações existentes por abordagens diferentes sem benefício necessário para a tarefa.

## Testes e verificação

Antes de finalizar uma alteração:

1. Execute os testes relacionados, quando existirem.
2. Execute o lint.
3. Verifique se o build continua funcionando.
4. Verifique se a alteração não quebrou comportamentos existentes relacionados.
5. Não corrija erros não relacionados encontrados durante essas verificações; apenas informe-os ao final.

## Dependências

- Não instalar novas dependências sem necessidade.
- Antes de adicionar uma dependência, verifique se a stack atual já oferece os recursos necessários.
- Não substituir bibliotecas existentes sem solicitação explícita.

## Finalização

Ao concluir:

- Informe resumidamente o que foi alterado.
- Liste arquivos relevantes modificados.
- Informe migrations criadas, se houver.
- Informe testes, lint e build executados e seus resultados.
- Mencione problemas encontrados que não foram corrigidos por estarem fora do escopo.
- Evite explicações extensas sobre alterações triviais.
