# VacineKids API Demo

API REST demonstrativa da nova arquitetura do VacineKids, desacoplada do frontend e do projeto legado em AWS Amplify.

## Estado atual do projeto

Implementado nesta etapa:

- fundação HTTP com Node.js, Express 5 e TypeScript;
- PostgreSQL com Prisma ORM;
- health check da aplicação e do banco;
- catálogo de vacinas;
- FAQs de vacinas;
- faixas etárias;
- pacotes, FAQs e composição pacote–vacina;
- CRUD REST versionado em `/api/v1`;
- migrations, seed fictício e testes de integração;
- autenticação server-side (cadastro, login, logout e `/auth/me`);
- autorização CUSTOMER/ADMIN e CLI local de promoção administrativa.
- perfil do responsável criado sob demanda;
- dependentes com ownership por sessão, paginação e exclusão lógica;
- checkout autoritativo e stateless, pedidos imutáveis, histórico e cancelamento.

Ainda não implementado:

- documentos;
- pagamentos ou Mercado Pago;
- agendamentos e reservas;
- estoque transacional.

As escritas do catálogo e `includeDeleted=true` exigem sessão ADMIN. Leituras normais continuam públicas. Para o teste controlado com o frontend no GitHub Pages, a sessão de produção usa cookie cross-site HttpOnly; o modo local preserva a política same-site. Consulte [o contrato e o guia de segurança](docs/auth-phase-1a.md).

`CUSTOMER` representa exclusivamente quem utiliza os serviços: pode criar o próprio perfil e gerenciar seus dependentes. `ADMIN` representa exclusivamente uma conta administrativa e recebe `403` nas rotas self-service. Uma pessoa que também queira utilizar os serviços deve manter uma conta CUSTOMER separada. O utilitário local de promoção recusa qualquer CUSTOMER que já possua `CustomerProfile` e preserva perfil, dependentes e sessões.

## Stack

- Node.js 24 LTS
- Express 5
- TypeScript em modo estrito
- PostgreSQL 18 no ambiente Docker demonstrativo
- Prisma ORM 7 com driver adapter `pg`
- Zod 4
- Helmet e CORS
- Node Test Runner e Supertest

## Modelo

```text
Vaccine ──< VaccineFaq
   │
   ├──< VaccineAgeRange >── AgeRange
   │
   └──< PackageVaccine >── Package ──< PackageFaq

User ── CustomerProfile ──< Dependent
              │                  │
              └──< Order ──< OrderItem ──< OrderItemRecipient
                                  │
                                  └──< OrderItemComponent
```

- Preços usam `DECIMAL(12,2)` e são devolvidos como strings com duas casas decimais.
- `Vaccine`, `Package` e `AgeRange` usam exclusão lógica por `deletedAt`.
- FAQs têm ordem explícita por `position`.
- `PackageVaccine.quantity` representa quantas unidades da vacina compõem o pacote.
- Estoque não faz parte do modelo atual.
- `CustomerProfile` é opcional e criado somente no primeiro `PUT /profile` completo.
- Telefones são persistidos em E.164 canônico.
- `Dependent.birthDate` usa PostgreSQL `DATE` e contrato público `YYYY-MM-DD`.
- `Dependent` usa soft delete; `CustomerProfile` não.
- O carrinho continua no frontend/localStorage; o preview de checkout não persiste dados.
- `Order` congela dados comerciais do cliente e dos produtos. Pacotes permanecem um único item e guardam sua composição histórica em `OrderItemComponent`.
- Valores de pedidos são calculados exclusivamente com `Prisma.Decimal`; preço, quantidade, total e moeda nunca são aceitos do cliente.

## Requisitos

- Node.js 24 LTS
- npm
- Uma instância PostgreSQL acessível, local, Docker ou hospedada
- Docker Compose somente se for utilizada a opção de container

## Instalação

```bash
npm install
```

No PowerShell, crie o arquivo de ambiente local:

```powershell
Copy-Item .env.example .env
```

No Linux/macOS:

```bash
cp .env.example .env
```

O `.env` é ignorado pelo Git. Nunca adicione credenciais reais ao `.env.example`.

Variáveis principais:

```dotenv
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://<usuario-local>:<senha-local>@localhost:5432/vacinekids_demo?schema=public
DATABASE_URL_UNPOOLED=
TEST_DATABASE_URL=postgresql://<usuario-local>:<senha-local>@localhost:5432/vacinekids_demo?schema=integration_test
FRONTEND_URL=http://localhost:5173
```

`DATABASE_URL` é usada pela aplicação e pelo seed de desenvolvimento e deve selecionar explicitamente `schema=public`.

Em ambientes Neon, `DATABASE_URL` mantém a conexão pooled para o runtime da API. Quando `DATABASE_URL_UNPOOLED` contiver uma URL não vazia, a Prisma CLI a prefere para migrations e operações administrativas. Um valor ausente, vazio ou composto somente por espaços faz fallback para `DATABASE_URL`; se ambas estiverem ausentes ou vazias, a configuração falha explicitamente sem imprimir seus valores. Para migrations no Neon production, permanece obrigatório preencher e validar operacionalmente `DATABASE_URL_UNPOOLED` antes da execução. Essas URLs remotas pertencem somente aos fluxos de runtime/administração apropriados e nunca ao perfil de integração local.

`TEST_DATABASE_URL` é exclusiva dos testes de integração e deve selecionar explicitamente `schema=integration_test`. O runner valida ambas as URLs antes de qualquer conexão: somente loopback (`localhost`, `127.0.0.1`, `[::1]`), mesmo host/porta, banco `vacinekids_demo`, desenvolvimento em `public`, testes em `integration_test` e apenas o parâmetro `schema`. URLs remotas (incluindo Neon/Render), ambíguas ou iguais são rejeitadas. Os arquivos de integração também possuem bootstrap obrigatório antes de importar app/Prisma. Não misture uma URL Neon de runtime com uma URL local de teste: use um perfil integralmente local, pois o runner abortará antes da conexão.

### Perfil local exclusivo para integração

Mantenha um `.env.integration` local, ignorado pelo Git e nunca commitado. Derive as duas URLs da mesma credencial válida do PostgreSQL local, alterando somente o schema:

```dotenv
DATABASE_URL=postgresql://<usuario-local>:<senha-local>@localhost:5432/vacinekids_demo?schema=public
TEST_DATABASE_URL=postgresql://<usuario-local>:<senha-local>@localhost:5432/vacinekids_demo?schema=integration_test
DATABASE_URL_UNPOOLED=
FRONTEND_URL=http://localhost:5173
```

No PowerShell, selecione esse arquivo explicitamente antes de executar a suíte:

```powershell
$env:DOTENV_CONFIG_PATH = ".env.integration"
npm test
```

O `DATABASE_URL_UNPOOLED` vazio faz a Prisma CLI usar `DATABASE_URL` e impede que a configuração local herde uma conexão administrativa remota. O perfil deve permanecer inteiramente em loopback, na porta `5432`, banco `vacinekids_demo`, com `public` para a referência de desenvolvimento e `integration_test` para a suíte.

## Perfil B — PostgreSQL local já instalado

Uma instalação PostgreSQL local existente pode usar outro usuário e outra senha; os valores precisam ser os que já são válidos nessa instalação. Mantenha, para esta suíte, loopback, porta `5432`, banco `vacinekids_demo` e os schemas `public`/`integration_test`.

Se ainda for necessário criar um banco e usuário exclusivos para a demonstração, este é um exemplo conceitual executado por um administrador PostgreSQL:

```sql
CREATE ROLE vacinekids WITH LOGIN PASSWORD 'vacinekids_dev';
CREATE DATABASE vacinekids_demo OWNER vacinekids;
```

Os valores acima são exclusivamente demonstrativos e coincidem com os padrões do Docker Compose deste repositório. Eles não são credenciais universais de uma instalação PostgreSQL já existente; ajuste o `.env` local sem versioná-lo.

## Perfil A — PostgreSQL com Docker Compose

Os valores concretos de usuário e senha presentes no `.env.example` são os padrões do `docker-compose.yml`. O arquivo inicia somente o PostgreSQL de desenvolvimento:

```bash
docker compose up -d
```

Confira o container:

```bash
docker compose ps
```

Encerre sem excluir os dados:

```bash
docker compose down
```

Para excluir também o volume local:

```bash
docker compose down -v
```

Se a porta 5432 já estiver ocupada, altere `POSTGRES_PORT` e a porta das URLs no `.env`.

O projeto não depende do Docker: qualquer PostgreSQL compatível funciona por meio de `DATABASE_URL`.

## Prisma e migrations

Valide o schema e gere o client:

```bash
npm run prisma:validate
npm run prisma:generate
```

Aplique as migrations existentes:

```bash
npm run prisma:deploy
```

Durante futuras alterações de modelo em desenvolvimento:

```bash
npm run prisma:migrate
```

Confira tabelas, chaves estrangeiras, checks, índices, colunas decimais e exclusão lógica:

```bash
npm run db:verify
```

## Seed demonstrativo

```bash
npm run db:seed
```

O seed é idempotente e contém somente dados fictícios:

- 10 vacinas;
- 5 faixas etárias;
- 4 pacotes;
- FAQs de vacinas e pacotes;
- composições pacote–vacina.

Executá-lo novamente atualiza os registros identificados por suas chaves naturais e substitui relações/FAQs sem criar duplicações inconsistentes.

## Execução em desenvolvimento

```bash
npm run dev
```

Endereços padrão:

- API: `http://localhost:3001/api/v1`
- Health check: `http://localhost:3001/health`

## Publicação no Render

Configure o repositório do backend como um **Web Service** com:

```text
Build Command: npm ci --include=dev && npm run build
Start Command: npm start
Health Check Path: /health
```

O serviço usa a porta fornecida por `PORT` e escuta em `0.0.0.0`; localmente, a porta padrão é `3001`. O startup inicia somente a API e não executa migration nem seed.

Variáveis necessárias no runtime do Render:

```dotenv
NODE_ENV=production
DATABASE_URL=<conexão pooled do Neon>
FRONTEND_URL=https://<usuario>.github.io
```

O Render fornece `PORT` automaticamente. `DATABASE_URL_UNPOOLED`, `TEST_DATABASE_URL` e `NEON_BRANCH` não são necessárias para iniciar a API. A origem do GitHub Pages não inclui o caminho `/vacinekids-web`.

O health check retorna HTTP `200` quando processo e banco estão disponíveis. Se o processo estiver funcionando, mas o PostgreSQL não responder, retorna HTTP `503`, `status: "degraded"` e `database: "disconnected"`. Credenciais e detalhes internos não são expostos.

## Testes

Somente validações unitárias:

```bash
npm run test:unit
```

Integração contra `TEST_DATABASE_URL`:

```bash
npm run test:integration
```

Todos os testes:

```bash
npm test
```

O runner de integração valida o isolamento antes de qualquer operação destrutiva e só então substitui `DATABASE_URL` pela `TEST_DATABASE_URL` no processo filho. O `PrismaPg` recebe também o schema extraído da URL, garantindo que as queries do Client sejam qualificadas para `integration_test`.

As migrations são aplicadas nesse mesmo ambiente. Antes e depois da suíte, o runner compara contagens e fingerprints das tabelas de catálogo, identidade, perfil e pedidos em `public`; ao final, também confirma que o cleanup deixou essas tabelas de `integration_test` vazias. Aplique primeiro a migration local de desenvolvimento com `npm run db:migrate:local`. As suítes de catálogo, auth, customer e orders são executadas sequencialmente e não utilizam Neon. Tokens, hashes e linhas dos snapshots nunca são impressos.

Cobertura atual de integração:

- health check com PostgreSQL;
- criação, listagem, filtro, alteração e soft delete de vacina;
- criação de pacote com composição;
- substituição atômica de FAQs;
- substituição atômica da composição do pacote;
- listagem de faixas etárias ativas;
- exclusão lógica de pacote;
- resposta `422` para payload inválido.
- profile ausente, criação/atualização idempotente, validação e `no-store`;
- dependentes, paginação, soft delete e data civil;
- isolamento CUSTOMER/ADMIN e testes explícitos contra BOLA/IDOR;
- bloqueio de promoção administrativa quando já existe perfil de cliente.
- preview autoritativo de Vaccine/Package e recipients CUSTOMER/DEPENDENT;
- snapshots, dinheiro Decimal, fingerprint e detecção de checkout alterado;
- criação atômica, idempotência concorrente, replay pós-timeout e colisão de número;
- histórico, detalhe, cancelamento idempotente e isolamento BOLA de pedidos;
- CORS, CSRF, `no-store`, limite de 32 KB e rate limiting das rotas comerciais.

## Contrato de resposta

Sucesso:

```json
{
  "data": {},
  "error": null
}
```

Listagem:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  },
  "error": null
}
```

Erro de validação:

```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": []
  }
}
```

## Endpoints

### Vacinas

| Método | Rota | Comportamento |
|---|---|---|
| `GET` | `/api/v1/vaccines` | Lista somente ativas por padrão |
| `GET` | `/api/v1/vaccines/:id` | Retorna apenas registro ativo |
| `POST` | `/api/v1/vaccines` | Cria vacina com FAQs e faixas |
| `PATCH` | `/api/v1/vaccines/:id` | Atualiza parcialmente |
| `DELETE` | `/api/v1/vaccines/:id` | Exclusão lógica |

Filtros: `page`, `pageSize`, `search`, `ageRange` e `includeDeleted`.

### Pacotes

| Método | Rota | Comportamento |
|---|---|---|
| `GET` | `/api/v1/packages` | Lista somente ativos por padrão |
| `GET` | `/api/v1/packages/:id` | Retorna pacote ativo e sua composição |
| `POST` | `/api/v1/packages` | Cria pacote, FAQs e composição |
| `PATCH` | `/api/v1/packages/:id` | Atualiza parcialmente |
| `DELETE` | `/api/v1/packages/:id` | Exclusão lógica |

Filtros: `page`, `pageSize`, `search`, `vaccineId`, `ageRange` e `includeDeleted`.

Em vacinas e pacotes, `ageRange` recebe o slug de uma faixa etária ativa. Nos pacotes, o filtro seleciona aqueles que contenham ao menos uma vacina ativa associada à faixa. A paginação usa `pageSize`.

Ao enviar `faqs` ou `vaccines` em um `PATCH`, a coleção enviada substitui integralmente a anterior em uma única operação Prisma.

### Faixas etárias

| Método | Rota | Comportamento |
|---|---|---|
| `GET` | `/api/v1/age-ranges` | Lista somente ativas por padrão |
| `GET` | `/api/v1/age-ranges/:id` | Retorna somente registro ativo |
| `POST` | `/api/v1/age-ranges` | Cria faixa etária |
| `PATCH` | `/api/v1/age-ranges/:id` | Atualiza parcialmente |
| `DELETE` | `/api/v1/age-ranges/:id` | Exclusão lógica |

As idades são representadas em meses. Um limite `null` significa faixa aberta.

### Perfil do responsável

Todas as rotas abaixo exigem uma sessão `CUSTOMER`. `ADMIN` recebe `403`.

| Método | Rota | Comportamento |
|---|---|---|
| `GET` | `/api/v1/profile` | Retorna o perfil próprio ou `data: null` |
| `PUT` | `/api/v1/profile` | Upsert completo com `name` e `phone` |

O perfil é resolvido exclusivamente por `req.auth.id`; `userId` não faz parte do payload nem da resposta. Nomes são normalizados com NFC, trim e espaços internos condensados, com 2–160 caracteres Unicode. O telefone deve chegar já em E.164, por exemplo `+5511999990001`.

### Dependentes

| Método | Rota | Comportamento |
|---|---|---|
| `GET` | `/api/v1/dependents` | Lista próprios registros ativos com `page` e `pageSize` |
| `POST` | `/api/v1/dependents` | Cria para o perfil autenticado; sem perfil retorna `409 PROFILE_REQUIRED` |
| `GET` | `/api/v1/dependents/:id` | Retorna somente registro próprio e ativo |
| `PATCH` | `/api/v1/dependents/:id` | Atualiza parcialmente `name` e/ou `birthDate` |
| `DELETE` | `/api/v1/dependents/:id` | Exclusão lógica |

`birthDate` aceita estritamente uma data civil real, não futura, no formato `YYYY-MM-DD`; timestamps são rejeitados. Não há idade máxima arbitrária. As queries de leitura, alteração e exclusão combinam o ID do dependente, `deletedAt = null` e `customerProfile.userId = req.auth.id`. Recurso inexistente, removido ou de outro CUSTOMER retorna o mesmo `404 DEPENDENT_NOT_FOUND`, impedindo enumeração/BOLA. `userId`, `customerProfileId` e campos internos nunca são aceitos em payload público.

Profile e dependentes usam `Cache-Control: no-store`. Escritas `PUT`, `POST`, `PATCH` e `DELETE` preservam a proteção de Origin/CSRF já existente. Não existe consulta administrativa de clientes nesta fase.

### Checkout e pedidos

Todas estas rotas exigem sessão `CUSTOMER`; `ADMIN` recebe `403`. Preview e criação exigem um `CustomerProfile`. A listagem sem perfil retorna uma página vazia, enquanto detalhe e cancelamento retornam `404 ORDER_NOT_FOUND`.

| Método | Rota | Comportamento |
|---|---|---|
| `POST` | `/api/v1/checkout/preview` | Resolve preços, recipients e composição atuais sem persistir |
| `POST` | `/api/v1/orders` | Cria um pedido atômico a partir de um preview ainda válido |
| `GET` | `/api/v1/orders` | Histórico próprio com `page` e `pageSize` |
| `GET` | `/api/v1/orders/:id` | Detalhe próprio com snapshots, recipients e components |
| `POST` | `/api/v1/orders/:id/cancel` | Cancela `PENDING_PAYMENT`; repetição é idempotente |

O cliente envia apenas `productType`, `productId` e os recipients (`CUSTOMER` ou `DEPENDENT`). `quantity` é sempre `recipients.length`; um recipient repetido representa outra unidade comercial e é permitido. Há limites de 10 produtos distintos, 10 recipients por item e 30 unidades no pedido.

O preview retorna BRL, preços e totais com duas casas, snapshots resolvidos, composição de Package — incluindo `PackageVaccine.quantity` e fabricante — e um `checkoutFingerprint` SHA-256 na versão 1. A criação relê tudo em uma transação `RepeatableRead`; se um preço, nome, fabricante, perfil, dependente ou composição tiver mudado, retorna `409 CHECKOUT_CHANGED`. Produto removido ou Package vazio/incompleto retorna `409 PRODUCT_UNAVAILABLE`; recipient inexistente, removido ou pertencente a outro cliente retorna `404 RECIPIENT_NOT_FOUND`.

`POST /orders` exige `Idempotency-Key` com UUID. A primeira criação retorna `201`; um replay da mesma intenção retorna o mesmo pedido com `200`, sem consultar novamente o catálogo, mesmo após mudanças posteriores. A mesma chave com outra intenção retorna `409 IDEMPOTENCY_KEY_REUSED`. O `requestHash` representa somente a intenção canônica recebida e é distinto do fingerprint do estado comercial. Chave, hashes e IDs internos de relacionamento não são expostos.

Pedidos nascem em `PENDING_PAYMENT` e podem passar apenas para `CANCELLED` nesta fase. Itens e snapshots não possuem rotas de edição. Não há Payment, agendamento ou estoque transacional implementado.

As rotas comerciais usam `Cache-Control: no-store`, JSON limitado a 32 KB e a proteção Origin/`X-VacineKids-CSRF` nas escritas. O preflight permite `Content-Type`, `X-VacineKids-CSRF` e `Idempotency-Key`. O preview aceita 60 requisições por 15 minutos por usuário; create e cancel compartilham proteção de 10 por 15 minutos por usuário. O `MemoryStore` é proteção local para uma única instância e não substitui a garantia de idempotência do PostgreSQL.

Erros específicos incluem `PROFILE_REQUIRED`, `PRODUCT_UNAVAILABLE`, `RECIPIENT_NOT_FOUND`, `CHECKOUT_CHANGED`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `ORDER_NOT_FOUND`, `ORDER_NOT_CANCELLABLE` e `RATE_LIMITED`, sempre no envelope padrão.

## Verificação completa sugerida

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run db:verify
npm run db:seed
npm run typecheck
npm test
npm audit
```
