import type { OutlineFont, ProjectDocument } from '@bannerfront/shared';
import * as opentypeNs from 'opentype.js';
import { useEffect, useMemo, useRef, useState } from 'react';

// opentype.js 2.x é UMD: aceita as funções no namespace ou em `default`, conforme o empacotador.
const opentype: typeof opentypeNs =
  typeof opentypeNs.parse === 'function' ? opentypeNs : (opentypeNs as unknown as { default: typeof opentypeNs }).default;

const cache = new Map<string, Promise<OutlineFont | null>>();

function loadFont(id: string): Promise<OutlineFont | null> {
  let promise = cache.get(id);
  if (!promise) {
    promise = fetch(`/api/fonts/${id}/file`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buffer) => opentype.parse(buffer) as unknown as OutlineFont)
      .catch(() => {
        cache.delete(id); // tenta de novo na próxima vez
        return null;
      });
    cache.set(id, promise);
  }
  return promise;
}

/** Fontes (já lidas) usadas pelas camadas de texto e botão do projeto. */
export function useOutlineFonts(doc: ProjectDocument): Record<string, OutlineFont | undefined> {
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const layer of doc.layers) {
      if ((layer.type === 'text' || layer.type === 'button') && layer.fontId) set.add(layer.fontId);
    }
    return [...set].sort();
  }, [doc.layers]);

  const [fonts, setFonts] = useState<Record<string, OutlineFont | undefined>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    for (const id of ids) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void loadFont(id).then((font) => {
        if (cancelled) return;
        if (font) setFonts((current) => ({ ...current, [id]: font }));
        else requested.current.delete(id);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [ids]);

  return fonts;
}
