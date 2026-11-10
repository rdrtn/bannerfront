import type { Layer, ProjectDocument } from '../project';
import { projectPassDurationMs } from '../project';
import { num, pct } from './util';

/** Estado animável de uma camada: opacidade (0 a 1, multiplica a opacidade fixa), deslocamento e escala. */
export interface AnimState {
  o: number;
  tx: number;
  ty: number;
  s: number;
}

export type StopEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';

/** `easing` vale do ponto atual até o próximo. */
export interface Stop {
  t: number;
  state: AnimState;
  easing: StopEasing;
}

export const VISIBLE: AnimState = { o: 1, tx: 0, ty: 0, s: 1 };
export const HIDDEN: AnimState = { o: 0, tx: 0, ty: 0, s: 1 };

/** Salto instantâneo é feito com uma rampa de 1 ms, imperceptível. */
const JUMP_MS = 1;

interface Canvas {
  width: number;
  height: number;
}

type Box = Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** Distância que garante que a camada saiu da área mesmo girada. */
function reach(layer: Box): { w: number; h: number } {
  if (!layer.rotation) return { w: layer.width, h: layer.height };
  const d = Math.hypot(layer.width, layer.height);
  return { w: d, h: d };
}

function offscreen(side: 'left' | 'right' | 'top' | 'bottom', layer: Box, canvas: Canvas): AnimState {
  const r = reach(layer);
  switch (side) {
    case 'left':
      return { o: 1, tx: -(layer.x + r.w), ty: 0, s: 1 };
    case 'right':
      return { o: 1, tx: canvas.width - layer.x, ty: 0, s: 1 };
    case 'top':
      return { o: 1, tx: 0, ty: -(layer.y + r.h), s: 1 };
    case 'bottom':
      return { o: 1, tx: 0, ty: canvas.height - layer.y, s: 1 };
  }
}

/** Estado de partida de uma entrada (de onde a camada vem). */
export function enterFromState(layer: Layer, canvas: Canvas): AnimState {
  const preset = layer.enter?.preset;
  switch (preset) {
    case 'fade-in':
      return { ...HIDDEN };
    case 'slide-in-left':
      return offscreen('left', layer, canvas);
    case 'slide-in-right':
      return offscreen('right', layer, canvas);
    case 'slide-in-top':
      return offscreen('top', layer, canvas);
    case 'slide-in-bottom':
      return offscreen('bottom', layer, canvas);
    case 'zoom-in':
      return { o: 0, tx: 0, ty: 0, s: 0.5 };
    default:
      return { ...VISIBLE };
  }
}

/** Estado de chegada de uma saída (para onde a camada vai). */
export function exitToState(layer: Layer, canvas: Canvas): AnimState {
  const preset = layer.exit?.preset;
  switch (preset) {
    case 'fade-out':
      return { ...HIDDEN };
    case 'slide-out-left':
      return offscreen('left', layer, canvas);
    case 'slide-out-right':
      return offscreen('right', layer, canvas);
    case 'slide-out-top':
      return offscreen('top', layer, canvas);
    case 'slide-out-bottom':
      return offscreen('bottom', layer, canvas);
    case 'zoom-out':
      return { o: 0, tx: 0, ty: 0, s: 0.5 };
    default:
      return { ...HIDDEN };
  }
}

const sameState = (a: AnimState, b: AnimState) => a.o === b.o && a.tx === b.tx && a.ty === b.ty && a.s === b.s;

/** A camada aparece o tempo todo, sem animação? */
export function isStaticLayer(layer: Layer, passMs: number): boolean {
  return (
    layer.timing.startMs <= 0 && !layer.enter && !layer.exit && layer.timing.endMs >= passMs && layer.keyframes.length === 0
  );
}

/**
 * Pontos de animação de UMA passada da linha do tempo (0 a passMs).
 * `holdEnd`: na última passada de um loop finito, camadas que vão até o fim ficam
 * visíveis (sem saída), para o banner terminar no quadro final.
 */
export function buildPassStops(layer: Layer, canvas: Canvas, passMs: number, holdEnd: boolean): Stop[] {
  const st = Math.max(0, layer.timing.startMs);
  const en = Math.min(passMs, layer.timing.endMs);
  const stops: Stop[] = [];
  const push = (t: number, state: AnimState, easing: StopEasing = 'linear') => stops.push({ t, state, easing });

  if (st > 0) {
    push(0, HIDDEN);
    push(st, HIDDEN);
  }

  let enterEnd = st;
  if (layer.enter) {
    const from = enterFromState(layer, canvas);
    const delay = Math.min(layer.enter.delayMs, Math.max(0, en - st));
    push(st, from);
    push(st + delay, from, layer.enter.easing);
    enterEnd = Math.min(st + delay + layer.enter.durationMs, en);
    push(enterEnd, VISIBLE);
  } else {
    push(st, VISIBLE);
  }

  const reachesEnd = layer.timing.endMs >= passMs;
  if (holdEnd && reachesEnd) {
    push(passMs, VISIBLE);
    return resolveStops(stops, passMs);
  }

  if (layer.exit) {
    const exitStart = Math.max(enterEnd, en - layer.exit.durationMs);
    push(exitStart, VISIBLE, layer.exit.easing);
    push(en, exitToState(layer, canvas));
  } else {
    push(en, VISIBLE);
  }
  push(en, HIDDEN);
  if (en < passMs) push(passMs, HIDDEN);
  return resolveStops(stops, passMs);
}

/**
 * Normaliza a lista: dois pontos no mesmo instante com estados diferentes viram um salto
 * (o primeiro recua 1 ms), e a lista sempre começa em 0 e termina em passMs.
 */
export function resolveStops(input: Stop[], passMs: number): Stop[] {
  const out: Stop[] = [];
  for (const stop of input) {
    const last = out[out.length - 1];
    if (last && last.t === stop.t) {
      if (sameState(last.state, stop.state)) {
        last.easing = stop.easing;
        continue;
      }
      const before = out[out.length - 2];
      last.t = stop.t - JUMP_MS;
      last.easing = 'linear';
      if (last.t < 0 || (before && last.t <= before.t)) out.pop();
    }
    out.push({ ...stop, state: { ...stop.state } });
  }
  const first = out[0];
  if (first && first.t > 0) out.unshift({ t: 0, state: { ...first.state }, easing: 'linear' });
  const last = out[out.length - 1];
  if (last && last.t < passMs) out.push({ t: passMs, state: { ...last.state }, easing: 'linear' });
  return out;
}

export function stopsEqual(a: Stop[], b: Stop[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.t === b[i]!.t && s.easing === b[i]!.easing && sameState(s.state, b[i]!.state))
  );
}

export function stateCss(state: AnimState): string {
  return `opacity:${num(state.o)};transform:translate(${num(state.tx)}px,${num(state.ty)}px) scale(${num(state.s)})`;
}

/** @keyframes de uma passada. */
export function keyframesCss(name: string, stops: Stop[], passMs: number): string {
  const frames = stops
    .map((s) => `${pct((s.t / passMs) * 100)}{${stateCss(s.state)};animation-timing-function:${s.easing}}`)
    .join('');
  return `@keyframes ${name}{${frames}}`;
}

// ---------------------------------------------------------------------------
// Plano de loops
// ---------------------------------------------------------------------------

export interface LoopPlan {
  passMs: number;
  /** `null` = infinito */
  passes: number | null;
}

export function loopPlan(doc: ProjectDocument): LoopPlan {
  return { passMs: projectPassDurationMs(doc), passes: doc.loop.mode === 'infinite' ? null : doc.loop.count };
}

/** A camada está na tela (dentro da janela de tempo) no instante `t` da passada? */
export function isLayerActiveAt(layer: Layer, t: number): boolean {
  return layer.timing.startMs <= t && t < layer.timing.endMs;
}
