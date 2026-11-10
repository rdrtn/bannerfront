import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../src/auth.js';
import { migrate } from '../src/db.js';
import { hashPassword, verifyPassword } from '../src/password.js';
import { createUser, login, makeTestFont, multipart, setupEnv, TEST_DATABASE_URL, userSession, type TestEnv } from './helpers.js';

describe('senhas', () => {
  it('gera hash com salt e confere a senha', async () => {
    const a = await hashPassword('uma-senha-longa');
    const b = await hashPassword('uma-senha-longa');
    expect(a).not.toBe(b);
    expect(await verifyPassword('uma-senha-longa', a)).toBe(true);
    expect(await verifyPassword('outra-senha-aqui', a)).toBe(false);
    expect(await verifyPassword('x', 'lixo')).toBe(false);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('API (precisa de TEST_DATABASE_URL)', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await setupEnv();
  });
  afterAll(async () => {
    await env.close();
  });
  beforeEach(async () => {
    await env.pool.query('TRUNCATE users, projects, fonts, audit_log RESTART IDENTITY CASCADE');
    await fs.rm(path.join(env.dataDir, 'fonts'), { recursive: true, force: true });
  });

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: unknown) =>
    env.app.inject({ method, url, payload: payload as object, headers: cookie ? { cookie } : {} });

  describe('migrações e bootstrap', () => {
    it('é idempotente', async () => {
      expect(await migrate(env.pool)).toEqual([]);
    });

    it('cria o admin inicial só quando não há usuários', async () => {
      const config = { ...env.config, bootstrapAdmin: { email: 'admin@x.com', password: 'senha-do-admin-1', name: 'Admin' } };
      expect(await bootstrapAdmin(env.pool, config)).toBe(true);
      expect(await bootstrapAdmin(env.pool, config)).toBe(false);
      expect((await call('POST', '/api/auth/login', undefined, { email: 'ADMIN@x.com', password: 'senha-do-admin-1' })).statusCode).toBe(200);
    });
  });

  describe('login', () => {
    it('autentica, devolve o usuário e mantém a sessão por cookie httpOnly', async () => {
      await createUser(env.pool, { email: 'ana@teste.com', role: 'designer', name: 'Ana' });
      const res = await call('POST', '/api/auth/login', undefined, { email: 'ana@teste.com', password: 'senha-super-segura' });
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({ email: 'ana@teste.com', role: 'designer', name: 'Ana' });
      expect(res.json().user.password_hash).toBeUndefined();
      const cookie = res.cookies.find((c) => c.name === 'bf_session')!;
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe('Lax');

      const me = await call('GET', '/api/auth/me', `bf_session=${cookie.value}`);
      expect(me.json().user.email).toBe('ana@teste.com');
    });

    it('recusa senha errada, e-mail inexistente e usuário desativado com a mesma mensagem', async () => {
      await createUser(env.pool, { email: 'ana@teste.com', role: 'designer' });
      await createUser(env.pool, { email: 'off@teste.com', role: 'designer', active: false });
      const bodies = [] as string[];
      for (const [email, password] of [
        ['ana@teste.com', 'errada-errada'],
        ['ninguem@teste.com', 'senha-super-segura'],
        ['off@teste.com', 'senha-super-segura'],
      ] as const) {
        const res = await call('POST', '/api/auth/login', undefined, { email, password });
        expect(res.statusCode).toBe(401);
        bodies.push(res.json().message);
      }
      expect(new Set(bodies).size).toBe(1);
    });

    it('exige login nas rotas protegidas e encerra a sessão no logout', async () => {
      expect((await call('GET', '/api/auth/me')).statusCode).toBe(401);
      expect((await call('GET', '/api/projects')).statusCode).toBe(401);

      const cookie = await userSession(env, 'designer');
      expect((await call('POST', '/api/auth/logout', cookie)).statusCode).toBe(204);
      expect((await call('GET', '/api/auth/me', cookie)).statusCode).toBe(401);
    });

    it('limita tentativas de login', async () => {
      const strict = await setupEnv({ LOGIN_RATE_LIMIT: '10' });
      try {
        let last = 0;
        for (let i = 0; i < 12; i++) {
          last = (await strict.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.com', password: 'x' } })).statusCode;
        }
        expect(last).toBe(429);
      } finally {
        await strict.close();
      }
    });

    it('rejeita requisições que alteram dados vindas de outra origem', async () => {
      const res = await env.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'a@b.com', password: 'x' },
        headers: { origin: 'https://site-malicioso.example', host: 'bannerfront.local' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('troca a senha e derruba as outras sessões', async () => {
      await createUser(env.pool, { email: 'ana@teste.com', role: 'designer' });
      const a = await login(env.app, 'ana@teste.com');
      const b = await login(env.app, 'ana@teste.com');
      const short = await call('POST', '/api/auth/change-password', a, { currentPassword: 'senha-super-segura', newPassword: 'curta' });
      expect(short.statusCode).toBe(400);
      const wrong = await call('POST', '/api/auth/change-password', a, { currentPassword: 'errada', newPassword: 'nova-senha-longa' });
      expect(wrong.statusCode).toBe(400);
      const ok = await call('POST', '/api/auth/change-password', a, { currentPassword: 'senha-super-segura', newPassword: 'nova-senha-longa' });
      expect(ok.statusCode).toBe(204);
      expect((await call('GET', '/api/auth/me', a)).statusCode).toBe(200);
      expect((await call('GET', '/api/auth/me', b)).statusCode).toBe(401);
      await login(env.app, 'ana@teste.com', 'nova-senha-longa');
    });
  });

  describe('usuários', () => {
    it('só o admin gerencia usuários', async () => {
      for (const role of ['designer', 'operacional', 'atendimento']) {
        const cookie = await userSession(env, role);
        expect((await call('GET', '/api/users', cookie)).statusCode).toBe(403);
        expect((await call('POST', '/api/users', cookie, {})).statusCode).toBe(403);
      }
      const admin = await userSession(env, 'admin');
      const list = await call('GET', '/api/users', admin);
      expect(list.statusCode).toBe(200);
      expect(list.json().users.length).toBe(4);
      expect(JSON.stringify(list.json())).not.toContain('password');
    });

    it('cria usuário, valida os dados e não repete e-mail', async () => {
      const admin = await userSession(env, 'admin');
      const ok = await call('POST', '/api/users', admin, {
        name: 'Beto',
        email: 'Beto@Teste.com',
        role: 'operacional',
        password: 'senha-do-beto-1',
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().user.email).toBe('beto@teste.com');
      await login(env.app, 'beto@teste.com', 'senha-do-beto-1');

      const dup = await call('POST', '/api/users', admin, { name: 'B', email: 'BETO@teste.com', role: 'designer', password: 'senha-do-beto-1' });
      expect(dup.statusCode).toBe(409);
      const weak = await call('POST', '/api/users', admin, { name: 'C', email: 'c@teste.com', role: 'designer', password: '123' });
      expect(weak.statusCode).toBe(400);
      const badRole = await call('POST', '/api/users', admin, { name: 'C', email: 'c@teste.com', role: 'chefe', password: 'senha-do-beto-1' });
      expect(badRole.statusCode).toBe(400);
    });

    it('desativar derruba as sessões do usuário', async () => {
      const admin = await userSession(env, 'admin');
      const id = await createUser(env.pool, { email: 'dani@teste.com', role: 'designer' });
      const dani = await login(env.app, 'dani@teste.com');
      expect((await call('PATCH', `/api/users/${id}`, admin, { active: false })).statusCode).toBe(200);
      expect((await call('GET', '/api/auth/me', dani)).statusCode).toBe(401);
      expect((await call('POST', '/api/auth/login', undefined, { email: 'dani@teste.com', password: 'senha-super-segura' })).statusCode).toBe(401);
    });

    it('protege o último administrador ativo', async () => {
      const admin = await userSession(env, 'admin');
      const { rows } = await env.pool.query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin'`);
      const id = rows[0]!.id;
      expect((await call('PATCH', `/api/users/${id}`, admin, { active: false })).statusCode).toBe(409);
      expect((await call('PATCH', `/api/users/${id}`, admin, { role: 'designer' })).statusCode).toBe(409);

      await createUser(env.pool, { email: 'admin2@teste.com', role: 'admin' });
      expect((await call('PATCH', `/api/users/${id}`, admin, { role: 'designer' })).statusCode).toBe(200);
    });

    it('redefine a senha', async () => {
      const admin = await userSession(env, 'admin');
      const id = await createUser(env.pool, { email: 'eli@teste.com', role: 'atendimento' });
      expect((await call('PATCH', `/api/users/${id}`, admin, { password: 'curta' })).statusCode).toBe(400);
      expect((await call('PATCH', `/api/users/${id}`, admin, { password: 'senha-redefinida-1' })).statusCode).toBe(200);
      await login(env.app, 'eli@teste.com', 'senha-redefinida-1');
    });
  });

  describe('projetos', () => {
    const newProject = (cookie: string, extra: Record<string, unknown> = {}) =>
      call('POST', '/api/projects', cookie, { name: 'ACSO - Prêmio', client: 'ACSO', kind: 'basic', formatId: 'billboard', ...extra });

    it('segue a matriz de permissões', async () => {
      const designer = await userSession(env, 'designer');
      const operacional = await userSession(env, 'operacional');
      const atendimento = await userSession(env, 'atendimento');
      const admin = await userSession(env, 'admin');

      const created = await newProject(designer);
      expect(created.statusCode).toBe(201);
      const id = created.json().project.id;

      expect((await newProject(operacional)).statusCode).toBe(403);
      expect((await newProject(atendimento)).statusCode).toBe(403);
      expect((await call('GET', `/api/projects/${id}`, operacional)).statusCode).toBe(200);
      expect((await call('GET', '/api/projects', atendimento)).statusCode).toBe(403);
      expect((await call('DELETE', `/api/projects/${id}`, designer)).statusCode).toBe(403);
      expect((await call('DELETE', `/api/projects/${id}`, admin)).statusCode).toBe(204);
      expect((await call('GET', `/api/projects/${id}`, admin)).statusCode).toBe(404);
    });

    it('cria no tamanho do formato e valida dimensões livres', async () => {
      const designer = await userSession(env, 'designer');
      const bill = await newProject(designer);
      expect(bill.json().document.canvas).toMatchObject({ width: 970, height: 250 });
      expect(bill.json().project).toMatchObject({ formatId: 'billboard', width: 970, height: 250, version: 1 });

      expect((await newProject(designer, { formatId: 'nao-existe' })).statusCode).toBe(400);
      expect((await newProject(designer, { formatId: 'custom' })).statusCode).toBe(400);
      expect((await newProject(designer, { formatId: 'custom', width: 8, height: 8 })).statusCode).toBe(400);
      const custom = await newProject(designer, { formatId: 'custom', kind: 'advanced', width: 640, height: 480 });
      expect(custom.statusCode).toBe(201);
      expect(custom.json().document).toMatchObject({ kind: 'advanced', canvas: { width: 640, height: 480 } });
    });

    it('salva com controle de versão e detecta conflito', async () => {
      const designer = await userSession(env, 'designer');
      const created = await newProject(designer);
      const { project, document } = created.json();

      document.canvas.background = '#112233';
      const saved = await call('PUT', `/api/projects/${project.id}`, designer, { version: 1, document, name: 'Novo nome' });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().project).toMatchObject({ version: 2, name: 'Novo nome', client: 'ACSO' });

      const stale = await call('PUT', `/api/projects/${project.id}`, designer, { version: 1, document });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe('version_conflict');

      const reopened = await call('GET', `/api/projects/${project.id}`, designer);
      expect(reopened.json().document.canvas.background).toBe('#112233');
    });

    it('recusa documento inválido e mudança de dimensões', async () => {
      const designer = await userSession(env, 'designer');
      const { project, document } = (await newProject(designer)).json();

      const broken = await call('PUT', `/api/projects/${project.id}`, designer, { version: 1, document: { ...document, kind: 'outro' } });
      expect(broken.statusCode).toBe(422);

      const resized = await call('PUT', `/api/projects/${project.id}`, designer, {
        version: 1,
        document: { ...document, formatId: 'retangulo-medio', canvas: { ...document.canvas, width: 300, height: 250 } },
      });
      expect(resized.statusCode).toBe(422);
      expect(resized.json().error).toBe('immutable_canvas');

      const ghost = await call('PUT', `/api/projects/${project.id}`, designer, {
        version: 1,
        document: { ...document, slides: [] , layers: [{ ...ghostLayer(), slideId: 'inexistente' }] },
      });
      expect(ghost.statusCode).toBe(422);
      expect(ghost.json().issues[0].code).toBe('unknown_slide');
    });

    it('filtra a lista por tipo e busca', async () => {
      const designer = await userSession(env, 'designer');
      await newProject(designer, { name: 'Alfa' });
      await newProject(designer, { name: 'Beta', client: 'Outro', kind: 'advanced' });
      const all = await call('GET', '/api/projects', designer);
      expect(all.json().projects).toHaveLength(2);
      expect((await call('GET', '/api/projects?kind=advanced', designer)).json().projects.map((p: { name: string }) => p.name)).toEqual(['Beta']);
      expect((await call('GET', '/api/projects?q=acso', designer)).json().projects.map((p: { name: string }) => p.name)).toEqual(['Alfa']);
      expect((await call('GET', '/api/projects?q=%25', designer)).json().projects).toHaveLength(0);
    });
  });

  describe('fontes', () => {
    const upload = (cookie: string, buf: Buffer | null, fields: Record<string, string>, name = 'fonte.ttf') => {
      const { payload, headers } = multipart(fields, buf ? { name, data: buf } : undefined);
      return env.app.inject({ method: 'POST', url: '/api/fonts', payload, headers: { ...headers, cookie } });
    };
    const license = { licenseConfirmed: 'true', licenseOrigin: 'Google Fonts, OFL' };

    it('cadastra uma fonte válida, lê os metadados e serve o arquivo', async () => {
      const cookie = await userSession(env, 'atendimento');
      const buf = makeTestFont('Fonte Teste Um', 'Bold', { weightClass: 700 });
      const res = await upload(cookie, buf, license);
      expect(res.statusCode).toBe(201);
      expect(res.json().font).toMatchObject({ family: 'Fonte Teste Um', format: 'otf', glyphCount: 2, source: 'upload' });

      const list = await call('GET', '/api/fonts', cookie);
      expect(list.json().fonts).toHaveLength(1);

      const file = await call('GET', `/api/fonts/${res.json().font.id}/file`, cookie);
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toBe('font/otf');
      expect(Buffer.compare(file.rawPayload, buf)).toBe(0);

      const stored = await fs.readdir(path.join(env.dataDir, 'fonts'));
      expect(stored).toHaveLength(1);
    });

    it('exige confirmação de licença e origem', async () => {
      const cookie = await userSession(env, 'designer');
      const buf = makeTestFont('Fonte Teste Dois');
      expect((await upload(cookie, buf, {})).json().error).toBe('license_required');
      expect((await upload(cookie, buf, { licenseConfirmed: 'false', licenseOrigin: 'x'.repeat(10) })).statusCode).toBe(400);
      expect((await upload(cookie, buf, { licenseConfirmed: 'true', licenseOrigin: '' })).statusCode).toBe(400);
      expect((await call('GET', '/api/fonts', cookie)).json().fonts).toHaveLength(0);
    });

    it('recusa arquivos que não são fontes, WOFF2 e envio sem arquivo', async () => {
      const cookie = await userSession(env, 'designer');
      const text = await upload(cookie, Buffer.from('isto não é uma fonte, é só texto comum para testar'), license, 'x.ttf');
      expect(text.statusCode).toBe(422);
      const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64)]);
      const w2 = await upload(cookie, woff2, license, 'x.woff2');
      expect(w2.statusCode).toBe(422);
      expect(w2.json().message).toMatch(/WOFF2/);
      const corrupt = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(64, 7)]);
      expect((await upload(cookie, corrupt, license)).statusCode).toBe(422);
      expect((await upload(cookie, null, license)).statusCode).toBe(400);
    });

    it('recusa fontes com licença de incorporação restrita (fsType)', async () => {
      const cookie = await userSession(env, 'designer');
      const buf = makeTestFont('Fonte Restrita');
      // Localiza a tabela OS/2 e grava fsType = 2 (offset 8 dentro da tabela).
      const numTables = buf.readUInt16BE(4);
      let patched = false;
      for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        if (buf.toString('latin1', rec, rec + 4) === 'OS/2') {
          buf.writeUInt16BE(2, buf.readUInt32BE(rec + 8) + 8);
          patched = true;
        }
      }
      expect(patched).toBe(true);
      const res = await upload(cookie, buf, license);
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/proíbe a incorporação/);
    });

    it('não duplica a mesma fonte', async () => {
      const cookie = await userSession(env, 'designer');
      const buf = makeTestFont('Fonte Teste Tres');
      expect((await upload(cookie, buf, license)).statusCode).toBe(201);
      const again = await upload(cookie, buf, license, 'copia.ttf');
      expect(again.statusCode).toBe(409);
      expect(again.json().font.family).toBe('Fonte Teste Tres');
    });

    it('só o admin remove, e não remove fonte em uso', async () => {
      const designer = await userSession(env, 'designer');
      const admin = await userSession(env, 'admin');
      const font = (await upload(designer, makeTestFont('Fonte Teste Quatro'), license)).json().font;

      expect((await call('DELETE', `/api/fonts/${font.id}`, designer)).statusCode).toBe(403);

      const { project, document } = (await call('POST', '/api/projects', designer, { name: 'P', kind: 'basic', formatId: 'billboard' })).json();
      document.layers = [{ ...ghostLayer(), type: 'text', slideId: document.slides[0].id, fontId: font.id, text: 'Oi', fontSize: 20, fontWeight: 400, color: '#000000', lineHeight: 1.2, letterSpacing: 0, align: 'left', animateBy: 'none' }];
      const saved = await call('PUT', `/api/projects/${project.id}`, designer, { version: 1, document });
      expect(saved.statusCode).toBe(200);

      const blocked = await call('DELETE', `/api/fonts/${font.id}`, admin);
      expect(blocked.statusCode).toBe(409);

      document.layers = [];
      await call('PUT', `/api/projects/${project.id}`, designer, { version: 2, document });
      expect((await call('DELETE', `/api/fonts/${font.id}`, admin)).statusCode).toBe(204);
      expect(await fs.readdir(path.join(env.dataDir, 'fonts'))).toHaveLength(0);
    });

    it('recusa arquivo acima do limite', async () => {
      const small = await setupEnv({ MAX_FONT_BYTES: '2000' });
      try {
        await createUser(small.pool, { email: 'd@teste.com', role: 'designer' });
        const cookie = await login(small.app, 'd@teste.com');
        const { payload, headers } = multipart(license, { name: 'big.ttf', data: Buffer.alloc(5000, 1) });
        const res = await small.app.inject({ method: 'POST', url: '/api/fonts', payload, headers: { ...headers, cookie } });
        expect(res.statusCode).toBe(413);
      } finally {
        await small.close();
      }
    });
  });

  describe('sistema', () => {
    it('health é público e o painel é só do admin', async () => {
      expect((await call('GET', '/api/health')).json()).toEqual({ status: 'ok' });
      const designer = await userSession(env, 'designer');
      const admin = await userSession(env, 'admin');
      expect((await call('GET', '/api/system/info', designer)).statusCode).toBe(403);
      expect((await call('POST', '/api/system/clear-temp', designer)).statusCode).toBe(403);
      expect((await call('GET', '/api/audit', designer)).statusCode).toBe(403);

      const info = await call('GET', '/api/system/info', admin);
      expect(info.json().counts).toMatchObject({ users: 2 });

      await fs.mkdir(path.join(env.dataDir, 'tmp'), { recursive: true });
      await fs.writeFile(path.join(env.dataDir, 'tmp', 'lixo.bin'), Buffer.alloc(1234));
      const cleared = await call('POST', '/api/system/clear-temp', admin);
      expect(cleared.json().freedBytes).toBe(1234);
      expect(await fs.readdir(path.join(env.dataDir, 'tmp'))).toHaveLength(0);

      const audit = await call('GET', '/api/audit', admin);
      expect(audit.json().entries.some((e: { action: string }) => e.action === 'temp_cleared')).toBe(true);
    });
  });
});

function ghostLayer() {
  return {
    id: 'layer-1',
    name: 'Camada',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    slideId: null as string | null,
    timing: { startMs: 0, endMs: 1000 },
    enter: null,
    exit: null,
    keyframes: [],
    templateSlot: null,
    type: 'shape',
    shape: 'rect',
    fill: '#ff0000',
    stroke: null,
    strokeWidth: 0,
    radius: 0,
    path: null,
  };
}
