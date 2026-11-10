import { describe, expect, it } from 'vitest';
import {
  buildBannerHtml,
  buildPassStops,
  checkProject,
  createEmptyProject,
  isStaticLayer,
  layoutText,
  projectDocumentSchema,
  textPathData,
  type Layer,
  type OutlineFont,
  type ProjectDocument,
} from './index';

// Fonte de mentira: todas as letras têm 5 px de largura a 10 px de corpo.
const fakeFont: OutlineFont = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  charToGlyph: (ch) => ({
    index: ch.codePointAt(0)!,
    advanceWidth: 500,
    getPath: (x, y) => ({ toPathData: () => `M${x} ${y}h1` }),
  }),
  getKerningValue: () => 0,
};

const canvas = { width: 970, height: 250 };

function layer(overrides: Record<string, unknown> = {}): Layer {
  return {
    id: 'layer-1',
    name: 'Camada',
    visible: true,
    locked: false,
    x: 100,
    y: 50,
    width: 200,
    height: 100,
    rotation: 0,
    opacity: 1,
    slideId: null,
    timing: { startMs: 0, endMs: 3000 },
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
    ...overrides,
  } as Layer;
}

const fade = (preset: string, durationMs = 500, delayMs = 0, easing = 'ease-out') => ({ preset, durationMs, delayMs, easing });

function doc(layers: Layer[], loop: ProjectDocument['loop'] = { mode: 'count', count: 1 }, slideMs = 3000): ProjectDocument {
  const base = createEmptyProject({ kind: 'basic', formatId: 'billboard' });
  return projectDocumentSchema.parse({
    ...base,
    loop,
    slides: [{ id: 'slide-1', name: 'Tela 1', startMs: 0, durationMs: slideMs }],
    layers,
    assets: { img: { kind: 'image', fileName: 'foto.jpg', mimeType: 'image/jpeg', width: 100, height: 100, bytes: 1000 } },
  });
}

const build = (d: ProjectDocument, extra: Partial<Parameters<typeof buildBannerHtml>[0]> = {}) =>
  buildBannerHtml({ doc: d, title: 'Teste', assetSrc: (id) => (id === 'img' ? '1.jpg' : null), fonts: { f1: fakeFont }, ...extra });

describe('pontos de animação', () => {
  it('entrada com fade começa invisível e chega a visível, e segura até o fim na última passada', () => {
    const stops = buildPassStops(layer({ enter: fade('fade-in') }), canvas, 3000, true);
    expect(stops.map((s) => [s.t, s.state.o])).toEqual([
      [0, 0],
      [500, 1],
      [3000, 1],
    ]);
    expect(stops[0]!.easing).toBe('ease-out');
  });

  it('saída antes do fim da passada termina escondida', () => {
    const stops = buildPassStops(layer({ timing: { startMs: 0, endMs: 1000 }, exit: fade('fade-out', 300) }), canvas, 3000, false);
    expect(stops.map((s) => [s.t, s.state.o])).toEqual([
      [0, 1],
      [700, 1],
      [1000, 0],
      [3000, 0],
    ]);
  });

  it('camada que começa depois fica escondida até o início, com salto de 1 ms', () => {
    const stops = buildPassStops(layer({ timing: { startMs: 1000, endMs: 3000 } }), canvas, 3000, true);
    expect(stops.map((s) => [s.t, s.state.o])).toEqual([
      [0, 0],
      [999, 0],
      [1000, 1],
      [3000, 1],
    ]);
  });

  it('slide vindo da esquerda parte de fora da área, e o atraso segura a posição inicial', () => {
    const stops = buildPassStops(layer({ enter: fade('slide-in-left', 600, 200, 'ease-in-out') }), canvas, 3000, true);
    const outside = -(100 + 200);
    expect(stops.map((s) => [s.t, s.state.tx])).toEqual([
      [0, outside],
      [200, outside],
      [800, 0],
      [3000, 0],
    ]);
    expect(stops[1]!.easing).toBe('ease-in-out');
  });

  it('slide vindo da direita e de baixo usam as bordas da área', () => {
    const right = buildPassStops(layer({ enter: fade('slide-in-right') }), canvas, 3000, true)[0]!;
    expect(right.state.tx).toBe(970 - 100);
    const bottom = buildPassStops(layer({ enter: fade('slide-in-bottom') }), canvas, 3000, true)[0]!;
    expect(bottom.state.ty).toBe(250 - 50);
  });

  it('saída que termina junto com a próxima passada vira salto, sem misturar estados', () => {
    const stops = buildPassStops(layer({ exit: fade('slide-out-left', 400) }), canvas, 3000, false);
    const times = stops.map((s) => s.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(stops[stops.length - 1]!.t).toBe(3000);
    expect(stops[stops.length - 1]!.state.o).toBe(0);
  });

  it('identifica camadas estáticas', () => {
    expect(isStaticLayer(layer(), 3000)).toBe(true);
    expect(isStaticLayer(layer({ enter: fade('fade-in') }), 3000)).toBe(false);
    expect(isStaticLayer(layer({ exit: fade('fade-out') }), 3000)).toBe(false);
    expect(isStaticLayer(layer({ timing: { startMs: 500, endMs: 3000 } }), 3000)).toBe(false);
    expect(isStaticLayer(layer({ timing: { startMs: 0, endMs: 2000 } }), 3000)).toBe(false);
  });
});

describe('texto em contornos', () => {
  const style = { fontSize: 10, lineHeight: 1.2, letterSpacing: 0, align: 'left' as const };

  it('quebra linhas pela largura e por \\n', () => {
    expect(layoutText(fakeFont, 'ab cd', 20, style).lines.map((l) => l.text)).toEqual(['ab', 'cd']);
    expect(layoutText(fakeFont, 'ab cd', 100, style).lines.map((l) => l.text)).toEqual(['ab cd']);
    expect(layoutText(fakeFont, 'ab\ncd', 100, style).lines.map((l) => l.text)).toEqual(['ab', 'cd']);
  });

  it('alinha à direita e ao centro e soma o espaçamento entre letras', () => {
    const right = layoutText(fakeFont, 'ab', 100, { ...style, align: 'right' });
    expect(right.lines[0]!.x).toBe(90);
    const center = layoutText(fakeFont, 'ab', 100, { ...style, align: 'center' });
    expect(center.lines[0]!.x).toBe(45);
    const spaced = layoutText(fakeFont, 'ab', 100, { ...style, letterSpacing: 2 });
    expect(spaced.lines[0]!.width).toBe(12);
  });

  it('posiciona a linha de base dentro da caixa da linha', () => {
    const layout = layoutText(fakeFont, 'a\nb', 100, style);
    // corpo 10, entrelinha 1.2 => caixa de 12; ascendente 8 e descendente 2 => base em 1 + 8 = 9
    expect(layout.lines[0]!.baseline).toBeCloseTo(9);
    expect(layout.lines[1]!.baseline).toBeCloseTo(21);
    expect(layout.height).toBeCloseTo(24);
  });

  it('gera um path por letra, cada uma na sua posição', () => {
    const layout = layoutText(fakeFont, 'ab', 100, style);
    expect(textPathData(fakeFont, layout, style)).toBe('M0 9h1M5 9h1');
  });
});

describe('HTML do banner', () => {
  const text = layer({
    id: 'titulo',
    type: 'text',
    text: 'Olá mundo',
    fontId: 'f1',
    fontSize: 20,
    fontWeight: 400,
    color: '#112233',
    lineHeight: 1.2,
    letterSpacing: 0,
    align: 'left',
    animateBy: 'none',
    enter: fade('fade-in'),
  });
  const photo = layer({ id: 'foto', type: 'image', assetId: 'img', fit: 'cover', focus: { x: 0.25, y: 0.75 } });
  const button = layer({
    id: 'btn',
    type: 'button',
    label: 'Saiba mais',
    fontId: 'f1',
    fontSize: 14,
    fontWeight: 700,
    textColor: '#ffffff',
    fill: '#ff6600',
    radius: 8,
  });

  it('é autossuficiente: CSS e JS dentro, clickTag, tamanho e sem endereços externos', () => {
    const { html, warnings } = build(doc([photo, text, button]));
    expect(warnings).toEqual([]);
    expect(html).toContain('var clickTag=""');
    expect(html).toContain('window.open(window.clickTag');
    expect(html).toContain('<meta name="ad.size" content="width=970,height=250">');
    expect(html).toContain('<img src="1.jpg"');
    expect(html).toContain('object-position:25% 75%');
    expect(html).toContain('<path d="M');
    expect(html).toContain('fill="#112233"');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
  });

  it('só anima o que precisa e deixa o resto estático', () => {
    const { html } = build(doc([photo, text]));
    expect((html.match(/@keyframes/g) ?? []).length).toBe(1);
    expect(html).toContain('.go #a1{animation:k1 3000ms linear 1 forwards}');
    expect(html).not.toContain('id="a0"');
  });

  it('no preview o clique não abre nada', () => {
    expect(build(doc([photo]), { mode: 'preview' }).html).not.toContain('window.open');
  });

  it('ignora camadas ocultas e avisa de fonte ou imagem ausentes', () => {
    const hidden = layer({ id: 'oculta', name: 'Oculta', visible: false });
    const noFont = { ...text, fontId: 'sumiu' } as Layer;
    const noImage = { ...photo, assetId: 'nada' } as Layer;
    const built = build(doc([hidden, noFont, noImage]));
    expect(built.warnings).toHaveLength(2);
    expect(built.skipped).toEqual(['Oculta', 'Camada', 'Camada']);
  });

  it('loop finito com saída no fim usa uma última passada que segura o quadro final', () => {
    const closing = layer({ exit: fade('fade-out', 400) });
    const { html } = build(doc([closing], { mode: 'count', count: 3 }));
    expect(html).toContain('@keyframes k0{');
    expect(html).toContain('@keyframes k0f{');
    expect(html).toContain('k0 3000ms linear 2,k0f 3000ms linear 6000ms 1 forwards');
  });

  it('loop infinito usa uma animação só, repetindo', () => {
    const { html } = build(doc([layer({ enter: fade('fade-in'), exit: fade('fade-out', 300) })], { mode: 'infinite' }));
    expect(html).toContain('k0 3000ms linear infinite');
    expect(html).not.toContain('k0f');
  });

  it('camada girada anima por dentro, sem perder a rotação', () => {
    const { html } = build(doc([layer({ rotation: 15, enter: fade('fade-in') })]));
    expect(html).toContain('transform:rotate(15deg)');
    expect(html).toContain('class="a" id="a0"');
  });

  it('o JSON de exemplo passa na verificação do projeto', () => {
    expect(checkProject(doc([photo, text, button])).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
