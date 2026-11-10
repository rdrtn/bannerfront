import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { formatDayMonthYear } from '@bannerfront/shared';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTestFont, multipart, setupEnv, TEST_DATABASE_URL, userSession, type TestEnv } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('imagens e exportação (precisa de TEST_DATABASE_URL)', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await setupEnv();
  });
  afterAll(async () => {
    await env.close();
  });
  beforeEach(async () => {
    await env.pool.query('TRUNCATE users, projects, fonts, audit_log RESTART IDENTITY CASCADE');
    await fs.rm(path.join(env.dataDir, 'assets'), { recursive: true, force: true });
    await fs.rm(path.join(env.dataDir, 'fonts'), { recursive: true, force: true });
  });

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
    env.app.inject({ method, url, payload: payload as object, headers: { cookie } });

  async function upload(cookie: string, url: string, field: Record<string, string>, file: { name: string; data: Buffer }) {
    const { payload, headers } = multipart(field, file);
    return env.app.inject({ method: 'POST', url, payload, headers: { ...headers, cookie } });
  }

  const photo = (w: number, h: number, noise = false) =>
    noise
      ? sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
      : sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 90, b: 160 } } })
          .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${h / 3}" fill="#ffaa00"/></svg>`) }])
          .jpeg({ quality: 90 })
          .toBuffer();

  const baseLayer = (id: string, extra: Record<string, unknown>) => ({
    id,
    name: id,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 970,
    height: 250,
    rotation: 0,
    opacity: 1,
    slideId: 'slide-1',
    timing: { startMs: 0, endMs: 3000 },
    enter: null,
    exit: null,
    keyframes: [],
    templateSlot: null,
    ...extra,
  });

  async function projectWithPhoto(cookie: string, opts: { noise?: number; media?: 'divulgacao' | 'avulsa'; withText?: boolean } = {}) {
    const created = await call('POST', '/api/projects', cookie, {
      name: 'Banner',
      media: opts.media ?? 'divulgacao',
      client: 'ACSO',
      ...(opts.media === 'avulsa' ? { subject: 'Prêmio Melhores do Ano' } : {}),
      kind: 'basic',
      formatId: 'billboard',
    });
    const { project, document } = created.json();

    const count = opts.noise ?? 1;
    document.layers = [];
    let firstAsset = '';
    for (let i = 0; i < count; i++) {
      const data = opts.noise ? await photo(970, 250, true) : await photo(2000, 800);
      const img = await upload(cookie, `/api/projects/${project.id}/assets`, {}, { name: `foto${i}.jpg`, data });
      expect(img.statusCode).toBe(201);
      const { assetId, asset } = img.json();
      firstAsset ||= assetId;
      document.assets[assetId] = asset;
      document.layers.push(
        baseLayer(`foto${i}`, {
          type: 'image', assetId, fit: 'cover', focus: { x: 0.5, y: 0.5 },
          enter: { preset: 'fade-in', durationMs: 500, delayMs: 0, easing: 'ease-out' },
        }),
      );
    }

    if (opts.withText) {
      const font = await upload(cookie, '/api/fonts', { licenseConfirmed: 'true' }, { name: 'f.otf', data: makeTestFont('Fonte Export') });
      expect(font.statusCode).toBe(201);
      document.layers.push(
        baseLayer('titulo', {
          type: 'text', text: 'AAA AAA', fontId: font.json().font.id, fontSize: 30, fontWeight: 400, color: '#ffffff',
          lineHeight: 1.2, letterSpacing: 0, align: 'left', animateBy: 'none', x: 20, y: 20, width: 300, height: 80,
          enter: { preset: 'slide-in-left', durationMs: 600, delayMs: 200, easing: 'ease-in-out' },
        }),
      );
    }

    const saved = await call('PUT', `/api/projects/${project.id}`, cookie, { version: 1, document });
    expect(saved.statusCode).toBe(200);
    return { id: project.id as string, assetId: firstAsset };
  }

  describe('imagens do projeto', () => {
    it('aceita PNG/JPG/WebP, lê as dimensões e serve de volta', async () => {
      const designer = await userSession(env, 'designer');
      const { project } = (await call('POST', '/api/projects', designer, { name: 'P', client: 'A', subject: 'B', kind: 'basic', formatId: 'billboard' })).json();
      const data = await photo(800, 600);
      const res = await upload(designer, `/api/projects/${project.id}/assets`, {}, { name: 'a.jpg', data });
      expect(res.statusCode).toBe(201);
      expect(res.json().asset).toMatchObject({ mimeType: 'image/jpeg', width: 800, height: 600, fileName: 'a.jpg' });

      const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
      expect((await upload(designer, `/api/projects/${project.id}/assets`, {}, { name: 'a.png', data: png })).json().asset.mimeType).toBe('image/png');

      const got = await call('GET', `/api/projects/${project.id}/assets/${res.json().assetId}`, designer);
      expect(got.statusCode).toBe(200);
      expect(got.headers['content-type']).toBe('image/jpeg');
      expect(Buffer.compare(got.rawPayload, data)).toBe(0);
    });

    it('recusa o que não é imagem, SVG e envio por quem só lê', async () => {
      const designer = await userSession(env, 'designer');
      const operacional = await userSession(env, 'operacional');
      const { project } = (await call('POST', '/api/projects', designer, { name: 'P', client: 'A', subject: 'B', kind: 'basic', formatId: 'billboard' })).json();
      const url = `/api/projects/${project.id}/assets`;
      expect((await upload(designer, url, {}, { name: 'x.jpg', data: Buffer.from('não sou imagem') })).statusCode).toBe(422);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
      expect((await upload(designer, url, {}, { name: 'x.svg', data: svg })).statusCode).toBe(422);
      expect((await upload(operacional, url, {}, { name: 'x.jpg', data: await photo(50, 50) })).statusCode).toBe(403);
      expect((await call('GET', `${url}/..%2Fx`, designer)).statusCode).toBe(404);
      expect((await call('GET', `${url}/naoexiste`, designer)).statusCode).toBe(404);
    });

    it('aceita imagem grande (mais de 5 MB)', async () => {
      const designer = await userSession(env, 'designer');
      const { project } = (await call('POST', '/api/projects', designer, { name: 'P', client: 'A', subject: 'B', kind: 'basic', formatId: 'billboard' })).json();
      const big = await photo(3000, 3000, true);
      expect(big.length).toBeGreaterThan(5_000_000);
      expect((await upload(designer, `/api/projects/${project.id}/assets`, {}, { name: 'big.jpg', data: big })).statusCode).toBe(201);
    });
  });

  describe('exportação', () => {
    it('gera o ZIP com o nome da mídia de divulgação, HTML autossuficiente e imagem otimizada', async () => {
      const designer = await userSession(env, 'designer');
      const { id } = await projectWithPhoto(designer, { withText: true });

      const report = (await call('GET', `/api/projects/${id}/export/report`, designer)).json().report;
      expect(report.ok).toBe(true);
      expect(report.zipName).toBe(`mdivul_bill_acso_${formatDayMonthYear(new Date())}`);
      expect(report.maxBytes).toBe(250_000);
      expect(report.overBudget).toBe(false);
      expect(report.files.map((f: { name: string }) => f.name)).toEqual(['index.html', '1.jpg']);
      expect(report.totalBytes).toBe(report.files.reduce((s: number, f: { bytes: number }) => s + f.bytes, 0));

      const res = await call('GET', `/api/projects/${id}/export/download`, designer);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toContain(`${report.zipName}.zip`);

      const files = unzipSync(new Uint8Array(res.rawPayload));
      expect(Object.keys(files).sort()).toEqual(['1.jpg', 'index.html']);
      const html = Buffer.from(files['index.html']!).toString('utf8');
      expect(html).toContain('var clickTag=""');
      expect(html).toContain('<img src="1.jpg"');
      expect(html).toContain('@keyframes');
      expect(html).toContain('<path d="M');

      // 2000x800 reduzido e recortado para a área de 970x250.
      const meta = await sharp(Buffer.from(files['1.jpg']!)).metadata();
      expect(meta).toMatchObject({ width: 970, height: 250, format: 'jpeg' });
    });

    it('mídia avulsa leva o assunto no nome', async () => {
      const designer = await userSession(env, 'designer');
      const { id } = await projectWithPhoto(designer, { media: 'avulsa' });
      const report = (await call('GET', `/api/projects/${id}/export/report`, designer)).json().report;
      expect(report.zipName).toBe(`mavul_bill_acso_premio-melhores-do-ano_${formatDayMonthYear(new Date())}`);
    });

    it('reduz a qualidade das imagens até caber no peso do formato', async () => {
      const designer = await userSession(env, 'designer');
      const { id } = await projectWithPhoto(designer, { noise: 3 });
      const report = (await call('GET', `/api/projects/${id}/export/report`, designer)).json().report;
      expect(report.ok).toBe(true);
      expect(report.imageQuality).toBeLessThan(88);
      expect(report.overBudget).toBe(false);
      expect(report.totalBytes).toBeLessThanOrEqual(250_000);
      expect(report.files).toHaveLength(4);
    });

    it('avisa quando nem a menor qualidade cabe, mas deixa baixar', async () => {
      const designer = await userSession(env, 'designer');
      const { id } = await projectWithPhoto(designer, { noise: 7 });
      const report = (await call('GET', `/api/projects/${id}/export/report`, designer)).json().report;
      expect(report.ok).toBe(true);
      expect(report.imageQuality).toBe(40);
      expect(report.overBudget).toBe(true);
      expect(report.warnings.join(' ')).toMatch(/limite do formato/);
      const res = await call('GET', `/api/projects/${id}/export/download`, designer);
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-export-over-budget']).toBe('true');
    });

    it('recusa projeto sem camadas visíveis ou com erro, sem gerar ZIP', async () => {
      const designer = await userSession(env, 'designer');
      const { project } = (await call('POST', '/api/projects', designer, { name: 'P', client: 'ACSO', kind: 'basic', formatId: 'billboard', subject: 'X' })).json();
      const report = (await call('GET', `/api/projects/${project.id}/export/report`, designer)).json().report;
      expect(report.ok).toBe(false);
      expect(report.errors.join(' ')).toMatch(/nenhuma camada visível/);
      const res = await call('GET', `/api/projects/${project.id}/export/download`, designer);
      expect(res.statusCode).toBe(422);
    });

    it('quem só visualiza (operacional) exporta; atendimento não', async () => {
      const designer = await userSession(env, 'designer');
      const operacional = await userSession(env, 'operacional');
      const atendimento = await userSession(env, 'atendimento');
      const { id } = await projectWithPhoto(designer);
      expect((await call('GET', `/api/projects/${id}/export/download`, operacional)).statusCode).toBe(200);
      expect((await call('GET', `/api/projects/${id}/export/report`, atendimento)).statusCode).toBe(403);
    });

    it('apagar o projeto apaga as imagens do disco', async () => {
      const designer = await userSession(env, 'designer');
      const admin = await userSession(env, 'admin');
      const { id } = await projectWithPhoto(designer);
      expect(await fs.readdir(path.join(env.dataDir, 'assets', id))).toHaveLength(1);
      expect((await call('DELETE', `/api/projects/${id}`, admin)).statusCode).toBe(204);
      await expect(fs.access(path.join(env.dataDir, 'assets', id))).rejects.toThrow();
    });
  });
});
