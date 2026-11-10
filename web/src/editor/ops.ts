import { projectPassDurationMs, type Layer, type ProjectDocument } from '@bannerfront/shared';

export type LayerType = Layer['type'];
type Slide = ProjectDocument['slides'][number];
type Asset = ProjectDocument['assets'][string];

export const TYPE_LABEL: Record<LayerType, string> = {
  text: 'Texto',
  image: 'Imagem',
  button: 'Botão',
  shape: 'Forma',
};

export function uid(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

const round = (n: number) => Math.round(n);

export interface NewLayerInput {
  type: LayerType;
  slideId: string | null;
  fontId?: string;
  assetId?: string;
  asset?: Asset;
}

/** Duração padrão da entrada de uma camada nova. */
const DEFAULT_ENTER = { preset: 'fade-in', durationMs: 500, delayMs: 0, easing: 'ease-out' } as const;

function windowFor(doc: ProjectDocument, slideId: string | null): { startMs: number; endMs: number } {
  const slide = slideId ? doc.slides.find((s) => s.id === slideId) : undefined;
  if (slide) return { startMs: slide.startMs, endMs: slide.startMs + slide.durationMs };
  return { startMs: 0, endMs: Math.max(3000, projectPassDurationMs(doc)) };
}

export function newLayer(doc: ProjectDocument, input: NewLayerInput): Layer {
  const { width: cw, height: ch } = doc.canvas;
  const count = doc.layers.filter((l) => l.type === input.type).length + 1;
  const base = {
    id: uid('l'),
    name: `${TYPE_LABEL[input.type]} ${count}`,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    slideId: input.slideId,
    timing: windowFor(doc, input.slideId),
    enter: { ...DEFAULT_ENTER },
    exit: null,
    keyframes: [],
    templateSlot: null,
  };

  const centered = (w: number, h: number) => ({
    x: round((cw - w) / 2),
    y: round((ch - h) / 2),
    width: w,
    height: h,
  });

  switch (input.type) {
    case 'text': {
      const w = Math.min(300, cw - 20);
      return {
        ...base,
        ...centered(w, Math.min(80, ch - 10)),
        type: 'text',
        text: 'Seu texto aqui',
        fontId: input.fontId ?? '',
        fontSize: Math.max(12, Math.min(28, round(ch / 6))),
        fontWeight: 400,
        color: '#111111',
        lineHeight: 1.2,
        letterSpacing: 0,
        align: 'left',
        animateBy: 'none',
      };
    }
    case 'button':
      return {
        ...base,
        ...centered(Math.min(140, cw - 10), Math.min(40, ch - 6)),
        type: 'button',
        label: 'Saiba mais',
        fontId: input.fontId ?? '',
        fontSize: 16,
        fontWeight: 700,
        textColor: '#ffffff',
        fill: '#e4572e',
        radius: 6,
      };
    case 'shape':
      return {
        ...base,
        ...centered(Math.min(120, cw - 10), Math.min(80, ch - 10)),
        type: 'shape',
        shape: 'rect',
        fill: '#3b82f6',
        stroke: null,
        strokeWidth: 0,
        radius: 0,
        path: null,
      };
    case 'image': {
      const a = input.asset!;
      const scale = Math.min(1, cw / a.width, ch / a.height);
      return {
        ...base,
        ...centered(round(a.width * scale), round(a.height * scale)),
        type: 'image',
        assetId: input.assetId!,
        fit: 'cover',
        focus: { x: 0.5, y: 0.5 },
      };
    }
  }
}

export function updateLayer(doc: ProjectDocument, id: string, patch: Record<string, unknown>): ProjectDocument {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) };
}

export function removeLayer(doc: ProjectDocument, id: string): ProjectDocument {
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id) };
}

export function duplicateLayer(doc: ProjectDocument, id: string): { doc: ProjectDocument; newId: string | null } {
  const index = doc.layers.findIndex((l) => l.id === id);
  const source = doc.layers[index];
  if (!source) return { doc, newId: null };
  const copy = { ...structuredClone(source), id: uid('l'), name: `${source.name} cópia`, x: source.x + 10, y: source.y + 10 } as Layer;
  const layers = [...doc.layers];
  layers.splice(index + 1, 0, copy);
  return { doc: { ...doc, layers }, newId: copy.id };
}

/** `up` leva a camada para a frente (fim da lista). */
export function moveLayer(doc: ProjectDocument, id: string, where: 'up' | 'down' | 'top' | 'bottom'): ProjectDocument {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(index, 1);
  const target =
    where === 'top' ? layers.length : where === 'bottom' ? 0 : Math.max(0, Math.min(layers.length, index + (where === 'up' ? 1 : -1)));
  layers.splice(target, 0, layer!);
  return { ...doc, layers };
}

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------

export function addSlide(doc: ProjectDocument): { doc: ProjectDocument; slideId: string } {
  const start = doc.slides.reduce((end, s) => Math.max(end, s.startMs + s.durationMs), 0);
  const slide: Slide = { id: uid('s'), name: `Tela ${doc.slides.length + 1}`, startMs: start, durationMs: 3000 };
  return { doc: { ...doc, slides: [...doc.slides, slide] }, slideId: slide.id };
}

/**
 * Altera uma tela e acompanha as camadas dela: mudar o início desloca todas;
 * mudar a duração estica ou encurta as que iam até o fim da tela.
 */
export function updateSlide(
  doc: ProjectDocument,
  slideId: string,
  patch: Partial<Pick<Slide, 'name' | 'startMs' | 'durationMs'>>,
): ProjectDocument {
  const slide = doc.slides.find((s) => s.id === slideId);
  if (!slide) return doc;
  const next: Slide = { ...slide, ...patch };
  next.startMs = Math.max(0, Math.round(next.startMs));
  next.durationMs = Math.max(100, Math.round(next.durationMs));

  const shift = next.startMs - slide.startMs;
  const oldEnd = slide.startMs + slide.durationMs;
  const newEnd = next.startMs + next.durationMs;

  const layers = doc.layers.map((layer) => {
    if (layer.slideId !== slideId) return layer;
    let { startMs, endMs } = layer.timing;
    startMs += shift;
    endMs += shift;
    if (endMs === oldEnd + shift) endMs = newEnd;
    if (endMs > newEnd) endMs = newEnd;
    if (startMs >= endMs) startMs = Math.max(next.startMs, endMs - 100);
    return { ...layer, timing: { startMs, endMs } };
  });

  return { ...doc, slides: doc.slides.map((s) => (s.id === slideId ? next : s)), layers };
}

export function removeSlide(doc: ProjectDocument, slideId: string): ProjectDocument {
  return {
    ...doc,
    slides: doc.slides.filter((s) => s.id !== slideId),
    layers: doc.layers.filter((l) => l.slideId !== slideId),
  };
}

export function fmtSeconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace('.', ',');
}
