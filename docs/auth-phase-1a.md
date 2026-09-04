# Autenticação e autorização — Fase 1A (backend)

Esta fase modifica e publica somente o backend. Não inclui frontend auth, Profile, dependentes, recuperação de senha, confirmação de email, OAuth/MFA/passkeys, checkout, pedidos, pagamentos, agendamento, estoque ou admin UI. A publicação não habilita autenticação no GitHub Pages nem cria usuários de produção. Domínios, proxy e rate limiting permanecem pendências antes da adoção da autenticação pelo frontend.

## Banco e migration

Uma migration nova: `20260904000000_auth_sessions_rbac`. A migration anterior permanece intacta. `User` contém somente UUID, email único varchar(254), passwordHash, role CUSTOMER/ADMIN (default CUSTOMER), status ACTIVE/DISABLED (default ACTIVE) e timestamps. O CHECK SQL `email = lower(btrim(email))` impede escrita não normalizada. Email de contas desabilitadas permanece reservado.

`Session` contém UUID, userId, tokenHash char(64) único, expiresAt, revokedAt opcional e timestamps. FK User→Session com ON DELETE CASCADE; índices `(userId, revokedAt)` e `(expiresAt)`. Não há deletedAt, dados de perfil ou atributos de dispositivo. Os timestamps usam TIMESTAMPTZ(3). A futura remoção de contas deve considerar novos relacionamentos antes de utilizar exclusão física.

## Execução local segura

Configure no processo/terminal URLs do mesmo PostgreSQL LOCAL, banco `vacinekids_demo`, com `schema=public` para DATABASE_URL e `schema=integration_test` para TEST_DATABASE_URL. Somente loopback e o parâmetro schema são aceitos pelos comandos protegidos. Não sobrescreva silenciosamente um `.env` já vinculado ao Neon.

Em PowerShell, usando suas credenciais locais (os valores abaixo são placeholders):

```powershell
$env:NODE_ENV = 'development'
$env:DATABASE_URL = 'postgresql://USUARIO:SENHA@localhost:5432/vacinekids_demo?schema=public'
$env:TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@localhost:5432/vacinekids_demo?schema=integration_test'
$env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL
$env:FRONTEND_URL = 'http://localhost:5173'
npm run db:migrate:local
npm run prisma:validate
npm run prisma:generate
npm run dev
```

Não coloque credenciais reais em arquivos versionados, histórico compartilhado ou capturas de tela. O comando `db:migrate:local` valida o alvo antes de iniciar Prisma e nunca aceita host remoto. O runtime usa DATABASE_URL; UNPOOLED não é necessário ao iniciar a API. `start` continua `tsx src/server.ts`; build continua generate + typecheck. Nenhuma migration, seed ou promoção executa no startup.

## Contrato HTTP

Prefixo `/api/v1/auth`. Todas as respostas auth usam `Cache-Control: no-store`.

| Endpoint | Entrada | Sucesso | Sessão |
| --- | --- | --- | --- |
| POST /register | JSON estrito `{email,password}` | 200 `{data:{message:"Solicitação processada. Você já pode tentar entrar com os dados informados."},error:null}` | Não cria sessão/cookie |
| POST /login | JSON estrito `{email,password}` | 200 `{data:{id,email,role,status},error:null}` | Cookie novo e sessão nova; revoga apenas a sessão apresentada pelo navegador |
| POST /logout | JSON `{}` | 204, corpo vazio | Revoga no banco e expira cookie; idempotente |
| GET /me | Cookie | 200 `{data:{id,email,role,status},error:null}` | Não renova prazo |

Cadastro novo/duplicado têm a mesma resposta. Duplicidade concorrente é tratada pelo índice único, sem alterar conta/senha/role/status existentes. Cadastro sempre cria CUSTOMER ACTIVE; campos extras (role/status/passwordHash etc.) são rejeitados com 422. Não existe login automático.

Login inexistente, senha incorreta e DISABLED retornam igualmente 401 `INVALID_CREDENTIALS`, mensagem `Email ou senha inválidos.`. `/me` inválido retorna 401 `UNAUTHENTICATED`. Dependência indisponível retorna 503, não 401. Logout que necessita do banco não anuncia sucesso nem remove cookie se a revogação falhar; cookie ausente/inválido não exige consulta ao banco.

Erros seguem `{data:null,error:{code,message,details?}}`: 400 JSON malformado; 401 autenticação; 403 permissão/Origin/CSRF; 413 tamanho; 415 content type; 422 Zod; 429 rate limit com Retry-After; 500 erro inesperado; 503 dependência indisponível. Auth limita JSON a 8 KiB; o limite existente do catálogo permanece 1 MiB.

## Senhas e sessões

- Email: trim externo + lowercase; sem regras específicas de Gmail/provedor.
- Senha: NFC consistente no cadastro/login, 15–128 caracteres Unicode no cadastro, espaços preservados, sem composição obrigatória, sem truncamento. Login aceita 1–128 para permitir evolução da política. Não há lista de senhas comuns nesta fase solicitada.
- Argon2id (`argon2`), 65536 KiB, timeCost 3, parallelism 1, hashLength 32; salt aleatório gerenciado pela biblioteca. Benchmark básico Windows/Node 24: aproximadamente 157 ms hash / 148 ms verify (não representa desempenho no Render).
- Verificação de usuário inexistente usa hash fictício equivalente, criado uma vez de forma lazy; a primeira chamada pode ter custo adicional. Mitiga, mas não garante eliminação de canais de timing.
- Há no máximo duas operações Argon2 simultâneas por processo; sem fila ilimitada. Saturação retorna 503 AUTH_BUSY.
- Token: randomBytes(32)→base64url; somente o cookie recebe o token bruto. Banco recebe SHA-256 hexadecimal. Nunca retornar token em JSON.
- Prazo absoluto: sete dias, sem sliding. Sessão válida exige hash, revokedAt nulo, expiresAt futuro e usuário ACTIVE. Role sempre é lida do User atual.
- Login e promoção serializam mudanças da conta por transação/bloqueio de linha. Promoção revoga todas as sessões; login substitui apenas a apresentada, mantendo outros dispositivos.
- Não há endpoint para desabilitação nesta fase. Quando esse fluxo existir, deverá revogar todas as sessões; o middleware já rejeita qualquer sessão de usuário DISABLED.
- Limpeza periódica de sessões expiradas/revogadas ainda não está agendada; definir retenção/manutenção antes de uso prolongado. Não ocorre no startup.

## Cookie, CORS e CSRF

Local: `vacinekids_session; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, sem Secure nem Domain. Use o mesmo hostname (localhost) no frontend e API.

Produção (`NODE_ENV=production`): `__Host-vacinekids_session; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`, sem Domain. Os atributos são derivados de NODE_ENV e testados; não dependem de headers de proxy.

GitHub Pages e onrender.com são cross-site. Esta fase NÃO usa SameSite=None nem Web Storage para contornar isso. Antes de integrar autenticação no frontend, configurar, por exemplo, `app.example.com` e `api.example.com` com HTTPS. Continuam cross-origin, exigindo credentials include no fetch, mas são same-site. A publicação atual mantém somente as consultas públicas do frontend, sem cadastro/login ou teste de cookies cross-site.

FRONTEND_URL deve ser origem HTTP(S) exata (sem caminho, slash final, query ou credenciais). Toda escrita em `/api/v1` exige Origin exatamente igual e `X-VacineKids-CSRF: 1`; ausência/null/origem diferente retorna 403 antes de efeitos colaterais. JSON exige application/json. Clientes não-browser que escrevem via HTTP também seguem o contrato, além de apresentar sessão autorizada. O header fixo força preflight; não é senha ou autorização.

CORS usa origem exata, credentials true, headers Content-Type/X-VacineKids-CSRF e métodos GET/HEAD/POST/PATCH/DELETE/OPTIONS. OPTIONS não exige login; GET não tem efeitos colaterais. CORS sozinho não protege escrita. `/health` e catálogo GET normal continuam públicos.

## RBAC e catálogo

POST/PATCH/DELETE de vacinas, pacotes e faixas etárias passam por requireAuth e requireRole("ADMIN") em TODOS os ambientes. `includeDeleted=true` exige os mesmos middlewares. Visitante recebe 401 e CUSTOMER 403, desde que Origin/CSRF sejam válidos para escritas. Leituras normais mantêm o contrato anterior, incluindo ageRange por slug, search, page e pageSize.

Ordem preservada: Origin/CSRF → autenticação → autorização → validação/operação do catálogo. Verificação local de POST administrativo:

| Cenário | HTTP |
| --- | --- |
| Origin correta + CSRF correto, sem sessão | 401 |
| Sem Origin e sem sessão | 403 |
| Origin correta + CSRF correto, CUSTOMER | 403 |
| Origin correta + CSRF correto, ADMIN e payload válido | 201 |

O 403 por ausência de Origin ocorre antes da autenticação; não indica que o visitante foi autenticado.

## Rate limiting e logs

Stores em memória, independentes por instância de aplicação: login 10 falhas/15 min por email normalizado (chave HMAC efêmera, não email puro), 50 tentativas/15 min por IP; cadastro 5/hora por IP. Não há bloqueio permanente. Identidades inexistentes também contam; login bem-sucedido não consome o limite de falhas.

Sem Redis e sem configurar trust proxy arbitrariamente. Antes de adotar autenticação no frontend, verificar cadeia real de proxies, limites para IPs compartilhados e necessidade de store compartilhado/persistente. No Render, sem trust proxy, o limite por IP pode agrupar usuários pelo proxy; esta publicação não promete limitação individual por IP do cliente. Restart perde contagens; múltiplas instâncias não compartilham limites.

O error handler registra apenas evento/código HTTP controlados para falhas inesperadas/dependências; nunca serializa Error, request, headers ou SQL. Não ativar logs de debug do driver com credenciais reais. Nunca registrar password, Cookie, Set-Cookie, token, hash ou DATABASE_URL. CLI mostra somente identidade pública ao operador e evento de promoção sem segredos.

## Primeiro ADMIN

Com DATABASE_URL/UNPOOLED explicitamente locais e NODE_ENV não production:

```bash
npm run user:promote
npm run user:promote -- --apply
```

Email é solicitado em terminal interativo, não em argumento CLI. Padrão dry-run: mostra ambiente local/public, UUID, email, role/status. `--apply` exige digitar `PROMOTE <UUID>` exatamente. Apenas CUSTOMER ACTIVE existente pode ser promovido. Transação altera role e revoga todas as sessões; deve fazer login novamente. Nenhum ADMIN é criado pelo seed ou pelo primeiro cadastro. Não existe endpoint de promoção.

A CLI desta fase rejeita TODOS os alvos remotos, inclusive Neon, e não possui flag de bypass. Antes de permitir administração de produção será necessária decisão explícita sobre acesso operacional. Como email não é verificado, confirme a identidade por outro meio antes de promover.

## Testes e validação

Com as URLs LOCAIS configuradas:

```bash
npm run test:unit
npm run test:integration
npm test
npm run typecheck
npm run build
npm audit
```

Unitários HTTP usam serviço injetado sem conectar ao banco. Integração valida ambas as URLs antes de snapshot/migration/cleanup; subprocessos recebem somente a URL integration_test como runtime e UNPOOLED vazio. Bootstrap nos dois arquivos exige NODE_ENV=test, URL de desenvolvimento local, URL de teste local e runtime igual ao teste antes de importar Prisma. Não execute arquivos de integração diretamente sem esse ambiente: serão rejeitados.

Runner verifica fingerprints de public antes/depois e limpeza de todas as tabelas do catálogo + users/sessions em integration_test. Fixtures ADMIN existem apenas no schema de teste. Testes de falha podem injetar indisponibilidade sem interromper PostgreSQL ou tocar dados públicos. Nenhum teste depende de Neon.

Pendências antes da adoção da autenticação pelo frontend: domínios HTTPS same-site, teste de cookies em navegador real, benchmark no Render, configuração comprovada de proxy e decisão de store.

## Risco transitivo aceito temporariamente para esta publicação

Em 2026-09-04, `npm audit` e `npm audit --omit=dev` continuam reportando quatro pacotes classificados como high na árvore Prisma, associados aos mesmos três advisories previamente investigados:

- `deepmerge-ts`: GHSA-ggr8-5vv4-36mx (high), no tooling/configuração Prisma.
- `mysql2`: GHSA-3f6p-5ww8-9rcr (high) e GHSA-rgwj-5xj2-c3m3 (moderate), no tooling MySQL.

O runtime da API usa PostgreSQL e não foi identificado caminho de exploração HTTP para esses advisories no estado atual. Isso não significa ausência de vulnerabilidades: o risco conhecido foi aceito temporariamente para esta publicação, sem zerar ou ocultar o audit. Reavaliar quando houver atualização compatível ou mudança de uso dessas dependências. Advisory novo exige interromper a publicação antes do push. Não aplicar fix automático, force, downgrade ou override.
