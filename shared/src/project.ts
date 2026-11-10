import { z } from 'zod';
import {
  CUSTOM_FORMAT_ID,
  CUSTOM_MAX_SIZE,
  CUSTOM_MIN_SIZE,
  findFormat,
} from './formats';

/**
 * Formato JSON do projeto (versão 1).
 *
 * Um único modelo serve ao Modo Básico e ao Modo Avançado, ao preview do
 * editor, à exportação HTML5 e ao vídeo:
 *
 * - `canvas`: tamanho do banner e cor de fundo.
 * - `slides`: telas do Modo Básico. Cada tela é uma janela de tempo
 *   (`startMs` + `durationMs`) e as telas podem se sobrepor.
 * - `layers`: camadas, da de baixo para a de cima. Cada camada tem a janela de
 *   tempo em que aparece (`timing`), uma animação de entrada e de saída
 *   (Modo Básico) e keyframes (Modo Avançado).
 * - `assets`: imagens enviadas, referenciadas pelas camadas de imagem.
 *
 * Todos os campos são explícitos (sem valores padrão implícitos), para que o
 * mesmo JSON gere sempre o mesmo resultado.
 */
export const PROJECT_SCHEMA_VERSION = 1;

/** Boa prática: no máximo 15 s de animação no total, somando os loops. */
export const MAX_TOTAL_DURATION_MS = 15_000;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use só letras, números, hífen e sublinhado.');

const colorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Cor no formato #rrggbb ou #rrggbbaa.');

const ms = z.number().int().min(0).max(600_000);

export const EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export const easingSchema = z.enum(EASINGS);

export const ENTER_PRESETS = [
  'fade-in',
  'slide-in-left',
  'slide-in-right',
  'slide-in-top',
  'slide-in-bottom',
  'zoom-in',
] as const;

export const EXIT_PRESETS = [
  'fade-out',
  'slide-out-left',
  'slide-out-right',
  'slide-out-top',
  'slide-out-bottom',
  'zoom-out',
] as const;

const transitionSchema = <T extends readonly [string, ...string[]]>(presets: T) =>
  z.object({
    preset: z.enum(presets),
    durationMs: ms,
    delayMs: ms,
    easing: easingSchema,
  });

export const enterSchema = transitionSchema(ENTER_PRESETS);
export const exitSchema = transitionSchema(EXIT_PRESETS);

const timingSchema = z.object({ startMs: ms, endMs: ms });

export const keyframeSchema = z.object({
  timeMs: ms,
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  /** Easing aplicado do keyframe anterior até este. */
  easing: easingSchema,
});

/** Posições dos slots de um template (Fase 2). */
export const TEMPLATE_SLOTS = ['logo', 'headline', 'cta-text', 'hero-image'] as const;

const layerBase = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  visible: z.boolean(),
  locked: z.boolean(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  /** Tela do Modo Básico a que a camada pertence (se houver). */
  slideId: idSchema.nullable(),
  timing: timingSchema,
  enter: enterSchema.nullable(),
  exit: exitSchema.nullable(),
  /** Só no Modo Avançado. */
  keyframes: z.array(keyframeSchema).max(200),
  templateSlot: z.enum(TEMPLATE_SLOTS).nullable(),
});

const imageLayer = layerBase.extend({
  type: z.literal('image'),
  assetId: idSchema,
  fit: z.enum(['cover', 'contain', 'fill']),
  /** Ponto de foco do recorte, de 0 a 1 em cada eixo. */
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
});

const textLayer = layerBase.extend({
  type: z.literal('text'),
  text: z.string().max(2000),
  /** Id da fonte cadastrada. */
  fontId: z.string().min(1).max(64),
  fontSize: z.number().positive().max(1000),
  fontWeight: z.number().int().min(100).max(900),
  color: colorSchema,
  lineHeight: z.number().positive().max(10),
  letterSpacing: z.number(),
  align: z.enum(['left', 'center', 'right']),
  /** Animação do texto em SVG: por letra ou por linha (Modo Avançado). */
  animateBy: z.enum(['none', 'letter', 'line']),
});

const buttonLayer = layerBase.extend({
  type: z.literal('button'),
  label: z.string().max(200),
  fontId: z.string().min(1).max(64),
  fontSize: z.number().positive().max(1000),
  fontWeight: z.number().int().min(100).max(900),
  textColor: colorSchema,
  fill: colorSchema,
  radius: z.number().min(0),
});

const shapeLayer = layerBase.extend({
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'path']),
  fill: colorSchema.nullable(),
  stroke: colorSchema.nullable(),
  strokeWidth: z.number().min(0),
  radius: z.number().min(0),
  /** Dados do path SVG, só quando `shape` é `path`. */
  path: z.string().max(20_000).nullable(),
});

export const layerSchema = z.discriminatedUnion('type', [imageLayer, textLayer, buttonLayer, shapeLayer]);
export type Layer = z.infer<typeof layerSchema>;

export const slideSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  startMs: ms,
  durationMs: z.number().int().min(1).max(600_000),
});

export const assetSchema = z.object({
  kind: z.literal('image'),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
});

export const loopSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('count'), count: z.number().int().min(1).max(99) }),
  z.object({ mode: z.literal('infinite') }),
]);

export const projectDocumentSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  kind: z.enum(['basic', 'advanced']),
  /** Id de um formato da tabela ou `custom` (dimensões livres). */
  formatId: z.string().min(1).max(64),
  canvas: z.object({
    width: z.number().int().min(CUSTOM_MIN_SIZE).max(CUSTOM_MAX_SIZE),
    height: z.number().int().min(CUSTOM_MIN_SIZE).max(CUSTOM_MAX_SIZE),
    background: colorSchema,
  }),
  loop: loopSchema,
  slides: z.array(slideSchema).max(50),
  layers: z.array(layerSchema).max(500),
  assets: z.record(idSchema, assetSchema),
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type ProjectKind = ProjectDocument['kind'];

// ---------------------------------------------------------------------------
// Criação de projetos
// ---------------------------------------------------------------------------

export interface NewProjectOptions {
  kind: ProjectKind;
  /** Id de um formato da tabela, ou `custom` com `width` e `height`. */
  formatId: string;
  width?: number;
  height?: number;
  background?: string;
}

export function createEmptyProject(options: NewProjectOptions): ProjectDocument {
  let width: number;
  let height: number;
  if (options.formatId === CUSTOM_FORMAT_ID) {
    if (!options.width || !options.height) {
      throw new Error('Informe a largura e a altura para dimensões livres.');
    }
    width = options.width;
    height = options.height;
  } else {
    const format = findFormat(options.formatId);
    if (!format) throw new Error(`Formato desconhecido: ${options.formatId}.`);
    width = format.width;
    height = format.height;
  }

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    kind: options.kind,
    formatId: options.formatId,
    canvas: { width, height, background: options.background ?? '#ffffff' },
    loop: { mode: 'count', count: 3 },
    slides: options.kind === 'basic' ? [{ id: 'slide-1', name: 'Tela 1', startMs: 0, durationMs: 3000 }] : [],
    layers: [],
    assets: {},
  };
}

// ---------------------------------------------------------------------------
// Validação semântica (além da forma do JSON)
// ---------------------------------------------------------------------------

export interface ProjectIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

/** Duração de uma passada da animação, em ms. */
export function projectPassDurationMs(doc: ProjectDocument): number {
  let end = 0;
  for (const slide of doc.slides) end = Math.max(end, slide.startMs + slide.durationMs);
  for (const layer of doc.layers) end = Math.max(end, layer.timing.endMs);
  return end;
}

/** Duração total, somando os loops. `null` quando o loop é infinito. */
export function projectTotalDurationMs(doc: ProjectDocument): number | null {
  if (doc.loop.mode === 'infinite') return null;
  return projectPassDurationMs(doc) * doc.loop.count;
}

/**
 * Confere as regras que o schema não alcança: formato e dimensões, ids únicos,
 * referências, janelas de tempo e duração máxima. Erros impedem salvar;
 * avisos não.
 */
export function checkProject(doc: ProjectDocument): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const error = (code: string, message: string, path?: string) =>
    issues.push({ severity: 'error', code, message, path });
  const warning = (code: string, message: string, path?: string) =>
    issues.push({ severity: 'warning', code, message, path });

  if (doc.formatId !== CUSTOM_FORMAT_ID) {
    const format = findFormat(doc.formatId);
    if (!format) {
      error('unknown_format', `Formato desconhecido: ${doc.formatId}.`, 'formatId');
    } else if (format.width !== doc.canvas.width || format.height !== doc.canvas.height) {
      error(
        'format_mismatch',
        `O formato ${format.label} tem ${format.width}x${format.height}, mas a área do banner tem ${doc.canvas.width}x${doc.canvas.height}.`,
        'canvas',
      );
    }
  }

  const slideIds = new Set<string>();
  doc.slides.forEach((slide, i) => {
    if (slideIds.has(slide.id)) error('duplicate_slide_id', `Tela repetida: ${slide.id}.`, `slides[${i}].id`);
    slideIds.add(slide.id);
  });

  const layerIds = new Set<string>();
  doc.layers.forEach((layer, i) => {
    const at = `layers[${i}]`;
    if (layerIds.has(layer.id)) error('duplicate_layer_id', `Camada repetida: ${layer.id}.`, `${at}.id`);
    layerIds.add(layer.id);

    if (layer.timing.endMs <= layer.timing.startMs) {
      error('invalid_timing', `A camada "${layer.name}" termina antes de começar.`, `${at}.timing`);
    }
    if (layer.slideId !== null && !slideIds.has(layer.slideId)) {
      error('unknown_slide', `A camada "${layer.name}" aponta para uma tela que não existe.`, `${at}.slideId`);
    }
    if (layer.type === 'image' && !(layer.assetId in doc.assets)) {
      error('unknown_asset', `A camada "${layer.name}" usa uma imagem que não foi enviada.`, `${at}.assetId`);
    }
    if (layer.type === 'shape' && layer.shape === 'path' && !layer.path) {
      error('missing_path', `A camada "${layer.name}" é um path sem dados.`, `${at}.path`);
    }
    if (layer.keyframes.length > 0) {
      if (doc.kind !== 'advanced') {
        error('keyframes_in_basic', `Keyframes só existem no Modo Avançado (camada "${layer.name}").`, `${at}.keyframes`);
      }
      for (let k = 1; k < layer.keyframes.length; k++) {
        const prev = layer.keyframes[k - 1];
        const curr = layer.keyframes[k];
        if (prev && curr && curr.timeMs <= prev.timeMs) {
          error('keyframes_order', `Os keyframes da camada "${layer.name}" precisam estar em ordem crescente.`, `${at}.keyframes[${k}]`);
          break;
        }
      }
    }
  });

  const passMs = projectPassDurationMs(doc);
  const totalMs = projectTotalDurationMs(doc);
  if (totalMs !== null && totalMs > MAX_TOTAL_DURATION_MS) {
    warning(
      'duration_exceeds',
      `A animação dura ${(totalMs / 1000).toFixed(1)} s no total (${(passMs / 1000).toFixed(1)} s x ${doc.loop.mode === 'count' ? doc.loop.count : 1} loops); a boa prática é até ${MAX_TOTAL_DURATION_MS / 1000} s. Use loop infinito se for intencional.`,
      'loop',
    );
  }

  return issues;
}

/** Atualiza um JSON salvo em versão antiga. Hoje só existe a versão 1. */
export function migrateProject(raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    const version = (raw as { schemaVersion: unknown }).schemaVersion;
    if (version === PROJECT_SCHEMA_VERSION) return raw;
    throw new Error(`Versão de projeto não suportada: ${String(version)}.`);
  }
  throw new Error('JSON de projeto sem schemaVersion.');
}
