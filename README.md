# Bannerfront

Sistema web para criar **display ads em HTML5** e **vídeos MP4** (pré-roll), em dois produtos:

- **Mídia de divulgação**: três banners por campanha (Billboard, Retângulo Médio e Mobile) feitos a partir de templates por formato.
- **Mídia avulsa**: qualquer tamanho de display ad criado do zero, e vídeos.

São duas ferramentas de criação: **Modo Básico** (telas/camadas com animações de entrada e saída) e **Modo Avançado** (linha do tempo com keyframes).

> **Estado atual: Fase 1 (Modo Básico + exportação HTML5).** Além da fundação (Docker Compose, login por perfis, formato de projeto em JSON, cadastro de fontes), já existem o editor do Modo Básico e a exportação do banner em ZIP, com texto convertido em SVG e verificação de peso. Clientes, campanhas e templates chegam na Fase 2 (veja o fim deste arquivo).

## Como rodar (Docker)

Pré-requisito: Docker com Docker Compose.

```bash
cp .env.example .env      # edite DB_PASSWORD, ADMIN_EMAIL e ADMIN_PASSWORD
docker compose up -d --build
```

Abra <http://localhost:3000> e entre com o `ADMIN_EMAIL` e a `ADMIN_PASSWORD` do `.env`. O administrador inicial só é criado quando ainda não há nenhum usuário. Depois do primeiro acesso, troque a senha em **Minha conta** e crie os demais usuários em **Usuários**.

- Os dados ficam em dois volumes Docker: `pgdata` (banco) e `appdata` (fontes e arquivos temporários).
- As migrações do banco rodam sozinhas na inicialização.
- Para HTTPS atrás de um proxy reverso, defina `COOKIE_SECURE=true` e `TRUST_PROXY=true`.
- **Backup:** ainda não há política definida. Enquanto isso, guarde cópias de `pg_dump` e do volume `appdata`:

  ```bash
  docker compose exec -T db pg_dump -U bannerfront bannerfront | gzip > backup-$(date +%Y%m%d).sql.gz
  ```

## Perfis e permissões

| Ação | Admin | Designer | Operacional | Atendimento |
|---|:-:|:-:|:-:|:-:|
| Gerenciar usuários, painel do sistema (limpar temporários, registro de atividades) | ✅ | | | |
| Criar e editar projetos nas ferramentas (Básico e Avançado) e templates | ✅ | ✅ | | |
| Ver projetos | ✅ | ✅ | ✅ | |
| Criar peças a partir de templates | ✅ | ✅ | ✅ | |
| Excluir projetos e criativos | ✅ | | | |
| Ver lista de criativos finalizados | ✅ | ✅ | ✅ | ✅ |
| Ver fontes e enviar fontes (confirmando a licença) | ✅ | ✅ | ✅ | ✅ |
| Remover fontes | ✅ | | | |

A matriz fica em `shared/src/permissions.ts` e é usada pelo servidor (que é quem decide) e pelo front-end (que só esconde o que não cabe ao perfil).

## Segurança do login

- Senhas com `scrypt` e sal individual; mínimo de 10 caracteres.
- Sessão no servidor (tabela `sessions`, só o hash do token é guardado) com cookie `httpOnly` e `SameSite=Lax`; expira por inatividade (`SESSION_TTL_HOURS`).
- Limite de 10 tentativas de login por minuto por IP; a resposta de erro é a mesma para e-mail inexistente, senha errada e usuário desativado.
- Requisições que alteram dados vindas de outra origem são recusadas.
- Desativar um usuário, mudar o perfil dele ou redefinir a senha encerra as sessões abertas. O último administrador ativo não pode ser desativado nem rebaixado.

## Fontes

Qualquer usuário pode enviar fontes **TTF, OTF ou WOFF** (WOFF2 e coleções `.ttc` não são aceitos), um estilo por arquivo. No envio é obrigatório marcar a confirmação de que há licença de uso; a confirmação fica registrada junto da fonte e no registro de atividades. O servidor valida o arquivo, lê família, estilo e peso, recusa fontes cuja licença proíbe incorporação (`fsType` restrito) e não aceita o mesmo arquivo duas vezes.

A cópia local do Google Fonts está prevista (campo `source = 'google'` já existe no banco), mas **ainda não foi importada**.

## Formato do projeto (JSON)

Todo projeto é um documento JSON validado por `zod` em `shared/src/project.ts`, com `schemaVersion` para migrações futuras. O mesmo documento serve ao Modo Básico e ao Modo Avançado (`kind`):

- `canvas`: largura, altura e cor de fundo. Tipo, formato e dimensões não mudam depois de criado.
- `loop`: número de repetições (1 a 99) ou infinito.
- `slides`: telas do Modo Básico (início e duração).
- `layers`: camadas dos tipos imagem, texto, botão e forma vetorial, cada uma com posição, tempo, animação de entrada e saída (preset, duração, atraso, easing) e, no Modo Avançado, keyframes. Camadas podem marcar um `templateSlot` (logo, título, texto do botão, imagem principal) para uso em templates.
- `assets`: imagens usadas (arquivo, tipo, dimensões, peso).

`checkProject` devolve erros (bloqueiam o salvamento) e avisos (por exemplo, animação com mais de 15 s no total, a menos que o loop seja infinito). O salvamento usa controle de versão otimista: se outra pessoa salvou antes, a API responde `409`.

## Editor do Modo Básico (Fase 1)

Em **Projetos**, crie um projeto (mídia avulsa ou de divulgação, cliente obrigatório, assunto só na avulsa) e clique no nome para abrir o editor:

- **Camadas**: texto, imagem (PNG, JPG ou WebP), botão e forma (retângulo ou elipse). Arraste no palco para mover, use as alças para redimensionar (Shift nos cantos mantém a proporção), setas do teclado movem 1 px (Shift: 10 px). Atalhos: Ctrl+Z / Ctrl+Y, Ctrl+S, Ctrl+D (duplicar), Delete.
- **Telas**: janelas de tempo; cada camada pertence a uma tela e tem tempo de entrada e saída. Mudar início ou duração da tela acompanha as camadas dela.
- **Animações**: entrada (fade, deslizar das quatro direções, zoom) e saída, cada uma com duração, atraso e aceleração.
- **Loop**: número de vezes (a última passada termina no quadro final) ou infinito. Aviso se passar de 15 s no total.
- **Prévia**: o palco mostra o mesmo HTML que será exportado; a linha do tempo permite reproduzir e posicionar em qualquer instante.
- **Exportar**: a aba *Exportar* confere peso (somado sem compressão) e avisos e baixa o ZIP `mdivul_...`/`mavul_...` com `index.html` na raiz. Imagens são otimizadas (reduzidas ao tamanho exibido, com qualidade reduzida automaticamente se preciso para caber no limite). Passando do limite, o download exige confirmação.

Como o texto vira contorno SVG (sem fonte embutida), o texto não tem **ligaduras** (fi, fl…) e o kerning usa só a tabela da fonte. Imagens SVG e GIF ainda não são aceitas.

## Formatos, pesos e nomes de ZIP

Os limites valem para o conteúdo do ZIP **sem compressão** (1 KB = 1000 bytes; se o ad server contar de outro jeito, ajustar em `shared/src/formats.ts`).

| Formato | Abreviação | Dimensões | Peso máximo |
|---|---|---|---|
| Billboard | `bill` | 970x250 | 250 KB |
| Retângulo Médio | `rmd` | 300x250 | 150 KB |
| Maxiboard | `maxi` | 970x150 | 200 KB |
| Banner Meia Página | `bmp` | 300x600 | 250 KB |
| Super Leaderboard | `slb` | 970x90 | 350 KB |
| Mobile | `mobile` | 320x100 | 100 KB |
| Dimensões livres | `970x250` etc. | 16 a 4096 px | 10 MB |

- Mídia de divulgação: `mdivul_<formato>_<cliente>_<diamesano>`, por exemplo `mdivul_bill_acso_091126`.
- Mídia avulsa: `mavul_<formato>_<cliente>_<assunto>_<diamesano>`, por exemplo `mavul_bill_acso_premio-melhores-do-ano_091126`.
- A data é a de criação, no fuso de São Paulo. Acentos são removidos, espaços viram hífen e tudo fica em minúsculas.
- Vídeo: só em 1280x720 ou 1920x1080, 29,97 fps (30000/1001). Os tipos de vídeo e a nomenclatura de vídeo em `shared/src/formats.ts` são **provisórios**.

## Desenvolvimento

Requer Node 22+ e um PostgreSQL 16.

```bash
npm install
export DATABASE_URL=postgres://usuario:senha@localhost:5432/bannerfront
export ADMIN_EMAIL=admin@local.dev ADMIN_PASSWORD=uma-senha-longa-123
npm run dev:server      # API em http://localhost:3000 (migrações automáticas)
npm run dev:web         # interface em http://localhost:5173 (proxy para a API)
```

Testes e verificações:

```bash
npm run typecheck
npm test                                  # testes do pacote compartilhado + testes de API pulados sem banco
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/bannerfront_test npm test
```

> Atenção: os testes de API **apagam e recriam o schema `public`** do banco informado em `TEST_DATABASE_URL`. Use um banco só para testes.

Estrutura:

```
shared/   regras compartilhadas: formatos, nomes de ZIP, permissões, JSON do projeto (zod)
server/   API Fastify + PostgreSQL (migrações em server/migrations)
web/      interface React + Vite (pt-BR)
```

## Próximas fases

| Fase | Entrega |
|---|---|
| 1 | **Entregue** (falta o teste real do banner no ad server): Modo Básico (editor por telas/camadas) e exportação HTML5 em ZIP, com texto convertido em SVG e verificação de peso. |
| 2 | Clientes e campanhas, templates por formato, mídia de divulgação com os 3 ZIPs e lista de criativos. |
| 3 | Modo Avançado (linha do tempo e keyframes, animação de texto por letra/linha). |
| 4 | Conversão para vídeo MP4 (Chromium + FFmpeg, 29,97 fps, uma faixa de áudio por projeto). |
