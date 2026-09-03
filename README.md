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
- migration, seed fictício e testes de integração.

Ainda não implementado:

- autenticação e autorização;
- clientes e dependentes;
- documentos;
- pedidos e itens de pedido;
- pagamentos ou Mercado Pago;
- agendamentos e reservas;
- estoque transacional.

As rotas de escrita estão intencionalmente sem autenticação e não devem ser expostas publicamente nesta etapa.

## Stack

- Node.js 22.18+; Node.js 24 recomendado
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
```

- Preços usam `DECIMAL(12,2)` e são devolvidos como strings com duas casas decimais.
- `Vaccine`, `Package` e `AgeRange` usam exclusão lógica por `deletedAt`.
- FAQs têm ordem explícita por `position`.
- `PackageVaccine.quantity` representa quantas unidades da vacina compõem o pacote.
- Estoque não faz parte do modelo atual.

## Requisitos

- Node.js 22.18 ou superior
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
DATABASE_URL=postgresql://vacinekids:vacinekids_dev@localhost:5432/vacinekids_demo?schema=public
TEST_DATABASE_URL=postgresql://vacinekids:vacinekids_dev@localhost:5432/vacinekids_demo?schema=integration_test
FRONTEND_URL=http://localhost:5173
```

`DATABASE_URL` é usada pela aplicação e pelo seed de desenvolvimento e deve selecionar explicitamente `schema=public`.

`TEST_DATABASE_URL` é exclusiva dos testes de integração e deve selecionar explicitamente `schema=integration_test`. O runner aborta antes de migrations ou cleanup quando a URL está ausente, é igual à URL de desenvolvimento, aponta para `public` ou não permite confirmar o schema isolado.

Para PostgreSQL hospedado, basta substituir as URLs. Caso o provedor exija TLS, configure os parâmetros SSL indicados pelo próprio provedor na URL.

## PostgreSQL local já instalado

Crie um banco e usuário exclusivos para a demonstração. Exemplo conceitual executado por um administrador PostgreSQL:

```sql
CREATE ROLE vacinekids WITH LOGIN PASSWORD 'vacinekids_dev';
CREATE DATABASE vacinekids_demo OWNER vacinekids;
```

Os valores acima são exclusivamente demonstrativos. Ajuste o `.env` se usar outro usuário, senha, host ou porta.

## PostgreSQL com Docker Compose

O arquivo `docker-compose.yml` inicia somente o PostgreSQL de desenvolvimento:

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

As migrations são aplicadas nesse mesmo ambiente. Antes e depois da suíte, o runner compara contagens e fingerprints das tabelas de catálogo em `public`; ao final, também confirma que o cleanup deixou as tabelas de catálogo de `integration_test` vazias.

Cobertura atual de integração:

- health check com PostgreSQL;
- criação, listagem, filtro, alteração e soft delete de vacina;
- criação de pacote com composição;
- substituição atômica de FAQs;
- substituição atômica da composição do pacote;
- listagem de faixas etárias ativas;
- exclusão lógica de pacote;
- resposta `422` para payload inválido.

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
