import { buildBannerHtml, isLayerActiveAt, type Layer, type OutlineFont, type ProjectDocument } from '@bannerfront/shared';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Box = { x: number; y: number; width: number; height: number };
type HandleId = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 4;

export const assetUrl = (projectId: string, assetId: string) => `/api/projects/${projectId}/assets/${assetId}`;

interface Props {
  projectId: string;
  title: string;
  doc: ProjectDocument;
  fonts: Record<string, OutlineFont | undefined>;
  time: number;
  playing: boolean;
  passMs: number;
  zoom: number;
  selectedId: string | null;
  readOnly: boolean;
  onSelect(id: string | null): void;
  onBox(id: string, box: Box): void;
  onTime(ms: number): void;
  onEnded(): void;
  onWarnings(warnings: string[]): void;
}

/** Pré-visualização (iframe com o mesmo HTML da exportação) e caixas de seleção por cima. */
export function Stage(props: Props) {
  const { doc, fonts, projectId, time, playing, passMs, zoom, selectedId, readOnly } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const [drag, setDrag] = useState<{ id: string; box: Box } | null>(null);

  // O HTML só é refeito um instante depois da última edição.
  const [stableDoc, setStableDoc] = useState(doc);
  useEffect(() => {
    const t = setTimeout(() => setStableDoc(doc), 120);
    return () => clearTimeout(t);
  }, [doc]);

  const built = useMemo(
    () =>
      buildBannerHtml({
        doc: stableDoc,
        title: props.title,
        fonts,
        mode: 'preview',
        assetSrc: (id) => (id in stableDoc.assets ? assetUrl(projectId, id) : null),
      }),
    [stableDoc, fonts, projectId, props.title],
  );

  const { onWarnings } = props;
  useEffect(() => onWarnings(built.warnings), [built.warnings, onWarnings]);

  const timeRef = useRef(time);
  timeRef.current = time;

  const animations = () => {
    try {
      return frame.current?.contentDocument?.getAnimations() ?? [];
    } catch {
      return [];
    }
  };

  const seek = (ms: number) => {
    for (const a of animations()) {
      a.pause();
      a.currentTime = ms;
    }
  };

  // Posiciona a animação no instante escolhido (quando não está tocando).
  useEffect(() => {
    if (!playing) seek(time);
  });

  // Reprodução: deixa a animação correr e acompanha o relógio dela.
  useEffect(() => {
    if (!playing) return;
    const list = animations();
    if (list.length === 0) {
      props.onEnded();
      return;
    }
    for (const a of list) {
      a.currentTime = timeRef.current;
      a.play();
    }
    let raf = 0;
    const tick = () => {
      const current = animations();
      const now = current.reduce((max, a) => Math.max(max, Number(a.currentTime ?? 0)), 0);
      const running = current.some((a) => a.playState === 'running');
      if (!running) {
        props.onEnded();
        return;
      }
      props.onTime(passMs > 0 ? now % passMs : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const { width, height } = doc.canvas;

  function startDrag(event: ReactPointerEvent, layer: Layer, handle: HandleId) {
    if (readOnly || layer.locked) return;
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin: Box = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    const ratio = origin.width / origin.height;
    let moved = false;
    let last: Box = origin;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;
      if (!moved && Math.hypot(dx, dy) * zoom < 3) return;
      moved = true;
      let { x, y, width: w, height: h } = origin;
      if (handle === 'move') {
        x += dx;
        y += dy;
      } else {
        if (handle.includes('e')) w = origin.width + dx;
        if (handle.includes('w')) {
          w = origin.width - dx;
          x = origin.x + dx;
        }
        if (handle.includes('s')) h = origin.height + dy;
        if (handle.includes('n')) {
          h = origin.height - dy;
          y = origin.y + dy;
        }
        if (e.shiftKey && handle.length === 2) {
          // mantém a proporção nos cantos
          if (Math.abs(w - origin.width) / origin.width > Math.abs(h - origin.height) / origin.height) h = w / ratio;
          else w = h * ratio;
          if (handle.includes('w')) x = origin.x + origin.width - w;
          if (handle.includes('n')) y = origin.y + origin.height - h;
        }
        if (w < MIN_SIZE) {
          if (handle.includes('w')) x -= MIN_SIZE - w;
          w = MIN_SIZE;
        }
        if (h < MIN_SIZE) {
          if (handle.includes('n')) y -= MIN_SIZE - h;
          h = MIN_SIZE;
        }
      }
      last = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
      setDrag({ id: layer.id, box: last });
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (moved) props.onBox(layer.id, last);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  return (
    <div className="stage-wrap" style={{ width: width * zoom, height: height * zoom }}>
      <div className="stage-scale" style={{ width, height, transform: `scale(${zoom})` }}>
        <iframe
          ref={frame}
          title="Pré-visualização"
          srcDoc={built.html}
          width={width}
          height={height}
          scrolling="no"
          onLoad={() => {
            if (!playing) seek(timeRef.current);
          }}
        />
      </div>
      <div className="stage-overlay" onPointerDown={() => props.onSelect(null)}>
        {doc.layers.map((layer) => {
          if (!layer.visible) return null;
          const box = drag?.id === layer.id ? drag.box : layer;
          const active = isLayerActiveAt(layer, time);
          const selected = layer.id === selectedId;
          if (!active && !selected) return null;
          return (
            <div
              key={layer.id}
              className={`ov${selected ? ' selected' : ''}${layer.locked ? ' locked' : ''}${active ? '' : ' inactive'}`}
              style={{
                left: box.x * zoom,
                top: box.y * zoom,
                width: box.width * zoom,
                height: box.height * zoom,
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
              }}
              title={layer.name}
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onSelect(layer.id);
                startDrag(e, layer, 'move');
              }}
            >
              {selected &&
                !layer.locked &&
                !readOnly &&
                HANDLES.map((h) => (
                  <span key={h} className={`handle h-${h}`} onPointerDown={(e) => startDrag(e, layer, h)} />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
