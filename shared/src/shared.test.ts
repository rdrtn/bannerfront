import { describe, expect, it } from 'vitest';
import {
  DISPLAY_FORMATS,
  KB,
  MB,
  PROJECT_SCHEMA_VERSION,
  ROLES,
  can,
  checkProject,
  createEmptyProject,
  findFormat,
  formatDayMonthYear,
  isVideoSize,
  maxBytesFor,
  migrateProject,
  projectDocumentSchema,
  projectPassDurationMs,
  projectTotalDurationMs,
  slugify,
  zipNameAvulsa,
  zipNameDivulgacao,
  type ProjectDocument,
} from './index';

describe('formatos', () => {
  it('traz os seis formatos com os pesos informados', () => {
    const byAbbr = Object.fromEntries(DISPLAY_FORMATS.map((f) => [f.abbr, f]));
    expect(byAbbr.bill).toMatchObject({ width: 970, height: 250, maxBytes: 250 * KB });
    expect(byAbbr.rmd).toMatchObject({ width: 300, height: 250, maxBytes: 150 * KB });
    expect(byAbbr.maxi).toMatchObject({ width: 970, height: 150, maxBytes: 200 * KB });
    expect(byAbbr.bmp).toMatchObject({ width: 300, height: 600, maxBytes: 250 * KB });
    expect(byAbbr.slb).toMatchObject({ width: 970, height: 90, maxBytes: 350 * KB });
    expect(byAbbr.mobile).toMatchObject({ width: 320, height: 100, maxBytes: 100 * KB });
  });

  it('usa 10 MB para dimensões livres', () => {
    expect(maxBytesFor('custom')).toBe(10 * MB);
    expect(maxBytesFor('billboard')).toBe(250 * KB);
  });

  it('só gera vídeo em 1280x720 ou 1920x1080', () => {
    expect(isVideoSize(1280, 720)).toBe(true);
    expect(isVideoSize(1920, 1080)).toBe(true);
    expect(isVideoSize(970, 250)).toBe(false);
  });
});

describe('nomes de ZIP', () => {
  it('remove acentos e troca espaços por hífen', () => {
    expect(slugify('Prêmio Melhores do Ano')).toBe('premio-melhores-do-ano');
    expect(slugify('  Ação & Reação!  ')).toBe('acao-reacao');
  });

  it('gera o nome da mídia de divulgação como nos exemplos', () => {
    const createdAt = new Date('2026-11-09T15:00:00Z');
    expect(zipNameDivulgacao({ formatAbbr: 'bill', client: 'ACSO', createdAt })).toBe('mdivul_bill_acso_091126');
    expect(zipNameDivulgacao({ formatAbbr: 'rmd', client: 'ACSO', createdAt })).toBe('mdivul_rmd_acso_091126');
  });

  it('gera o nome da mídia avulsa com o assunto', () => {
    const createdAt = new Date('2026-11-09T15:00:00Z');
    expect(
      zipNameAvulsa({ formato: 'bill', client: 'ACSO', subject: 'Prêmio Melhores do Ano', createdAt }),
    ).toBe('mavul_bill_acso_premio-melhores-do-ano_091126');
    expect(zipNameAvulsa({ formato: '970x250', client: 'Acme Ltda', subject: 'Black Friday', createdAt })).toBe(
      'mavul_970x250_acme-ltda_black-friday_091126',
    );
  });

  it('usa a data no fuso de São Paulo', () => {
    // 02:00 UTC de 10/11 ainda é 23:00 de 09/11 em São Paulo.
    expect(formatDayMonthYear(new Date('2026-11-10T02:00:00Z'))).toBe('091126');
    expect(formatDayMonthYear(new Date('2026-11-10T04:00:00Z'))).toBe('101126');
  });

  it('recusa campos vazios', () => {
    const createdAt = new Date('2026-11-09T15:00:00Z');
    expect(() => zipNameAvulsa({ formato: 'bill', client: 'ACSO', subject: '!!!', createdAt })).toThrow(/Assunto/);
  });
});

describe('permissões', () => {
  it('separa o que cada perfil pode fazer', () => {
    expect(can('admin', 'users:manage')).toBe(true);
    expect(can('designer', 'users:manage')).toBe(false);
    expect(can('designer', 'projects:write')).toBe(true);
    expect(can('operacional', 'projects:write')).toBe(false);
    expect(can('operacional', 'pieces:create')).toBe(true);
    expect(can('atendimento', 'pieces:create')).toBe(false);
    expect(can('atendimento', 'projects:read')).toBe(false);
    expect(can('atendimento', 'creatives:read')).toBe(true);
    expect(can('designer', 'projects:delete')).toBe(false);
    expect(can(null, 'fonts:read')).toBe(false);
  });

  it('deixa qualquer perfil subir fontes', () => {
    for (const role of ROLES) expect(can(role, 'fonts:upload')).toBe(true);
  });
});

describe('projeto', () => {
  const basic = () => createEmptyProject({ kind: 'basic', formatId: 'billboard' });

  const layer = (overrides: Record<string, unknown> = {}) => ({
    id: 'layer-1',
    name: 'Fundo',
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
    enter: { preset: 'fade-in', durationMs: 500, delayMs: 0, easing: 'ease-out' },
    exit: null,
    keyframes: [],
    templateSlot: null,
    type: 'shape',
    shape: 'rect',
    fill: '#003366',
    stroke: null,
    strokeWidth: 0,
    radius: 0,
    path: null,
    ...overrides,
  });

  it('cria um projeto vazio válido no tamanho do formato', () => {
    const doc = basic();
    expect(projectDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc.canvas).toMatchObject({ width: 970, height: 250 });
    expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc.slides).toHaveLength(1);
    expect(checkProject(doc)).toEqual([]);
  });

  it('exige largura e altura em dimensões livres', () => {
    expect(() => createEmptyProject({ kind: 'advanced', formatId: 'custom' })).toThrow();
    const doc = createEmptyProject({ kind: 'advanced', formatId: 'custom', width: 640, height: 480 });
    expect(doc.canvas).toMatchObject({ width: 640, height: 480 });
    expect(doc.slides).toEqual([]);
  });

  it('aceita uma camada completa e recusa campos inválidos', () => {
    const ok = { ...basic(), layers: [layer()] };
    expect(projectDocumentSchema.safeParse(ok).success).toBe(true);

    const badColor = { ...basic(), layers: [layer({ fill: 'azul' })] };
    expect(projectDocumentSchema.safeParse(badColor).success).toBe(false);

    const badPreset = { ...basic(), layers: [layer({ enter: { preset: 'giro', durationMs: 1, delayMs: 0, easing: 'ease' } })] };
    expect(projectDocumentSchema.safeParse(badPreset).success).toBe(false);
  });

  it('detecta formato inconsistente com as dimensões', () => {
    const doc: ProjectDocument = { ...basic(), canvas: { width: 300, height: 250, background: '#ffffff' } };
    expect(checkProject(doc).map((i) => i.code)).toContain('format_mismatch');
    expect(checkProject({ ...basic(), formatId: 'inexistente' }).map((i) => i.code)).toContain('unknown_format');
  });

  it('detecta ids repetidos, tela e imagem inexistentes', () => {
    const doc = projectDocumentSchema.parse({
      ...basic(),
      layers: [
        layer(),
        layer({ slideId: 'slide-9' }),
        layer({ id: 'img', type: 'image', assetId: 'sumiu', fit: 'cover', focus: { x: 0.5, y: 0.5 } }),
      ],
    });
    const codes = checkProject(doc).map((i) => i.code);
    expect(codes).toContain('duplicate_layer_id');
    expect(codes).toContain('unknown_slide');
    expect(codes).toContain('unknown_asset');
  });

  it('recusa janela de tempo invertida e keyframes no Modo Básico', () => {
    const doc = projectDocumentSchema.parse({
      ...basic(),
      layers: [
        layer({
          timing: { startMs: 2000, endMs: 1000 },
          keyframes: [{ timeMs: 0, opacity: 0, easing: 'linear' }],
        }),
      ],
    });
    const codes = checkProject(doc).map((i) => i.code);
    expect(codes).toContain('invalid_timing');
    expect(codes).toContain('keyframes_in_basic');
  });

  it('exige keyframes em ordem crescente no Modo Avançado', () => {
    const doc = projectDocumentSchema.parse({
      ...createEmptyProject({ kind: 'advanced', formatId: 'billboard' }),
      layers: [
        layer({
          slideId: null,
          keyframes: [
            { timeMs: 500, opacity: 1, easing: 'linear' },
            { timeMs: 500, opacity: 0, easing: 'linear' },
          ],
        }),
      ],
    });
    expect(checkProject(doc).map((i) => i.code)).toContain('keyframes_order');
  });

  it('avisa quando a duração passa de 15 s no total, a menos que o loop seja infinito', () => {
    const base = projectDocumentSchema.parse({
      ...basic(),
      slides: [{ id: 'slide-1', name: 'Tela 1', startMs: 0, durationMs: 6000 }],
      layers: [layer({ timing: { startMs: 0, endMs: 6000 } })],
    });
    expect(projectPassDurationMs(base)).toBe(6000);
    expect(projectTotalDurationMs(base)).toBe(18000);
    expect(checkProject(base).map((i) => i.code)).toContain('duration_exceeds');

    const twice = { ...base, loop: { mode: 'count' as const, count: 2 } };
    expect(checkProject(twice)).toEqual([]);

    const infinite = { ...base, loop: { mode: 'infinite' as const } };
    expect(projectTotalDurationMs(infinite)).toBeNull();
    expect(checkProject(infinite)).toEqual([]);
  });

  it('migra só a versão atual', () => {
    expect(migrateProject(basic())).toBeTruthy();
    expect(() => migrateProject({ schemaVersion: 99 })).toThrow();
    expect(() => migrateProject({})).toThrow();
  });

  it('encontra formatos por id', () => {
    expect(findFormat('mobile')?.abbr).toBe('mobile');
    expect(findFormat('nao-existe')).toBeUndefined();
  });
});
