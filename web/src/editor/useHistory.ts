import { useCallback, useRef, useState } from 'react';

interface State<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 100;

/**
 * Histórico de desfazer/refazer. Edições seguidas com a mesma `coalesce` (ex.: digitar num campo)
 * dentro de 1 s viram um passo só.
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<State<T>>({ past: [], present: initial, future: [] });
  const lastKey = useRef<{ key: string; at: number } | null>(null);

  const set = useCallback((next: T | ((current: T) => T), coalesce?: string) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(s.present) : next;
      if (value === s.present) return s;
      const now = Date.now();
      const merge = !!coalesce && lastKey.current?.key === coalesce && now - lastKey.current.at < 1000;
      lastKey.current = coalesce ? { key: coalesce, at: now } : null;
      const past = merge ? s.past : [...s.past, s.present].slice(-LIMIT);
      return { past, present: value, future: [] };
    });
  }, []);

  /** Troca o estado atual sem criar passo (ex.: ao carregar do servidor). */
  const reset = useCallback((value: T) => {
    lastKey.current = null;
    setState({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    lastKey.current = null;
    setState((s) => {
      const previous = s.past[s.past.length - 1];
      if (previous === undefined) return s;
      return { past: s.past.slice(0, -1), present: previous, future: [s.present, ...s.future] };
    });
  }, []);

  const redo = useCallback(() => {
    lastKey.current = null;
    setState((s) => {
      const next = s.future[0];
      if (next === undefined) return s;
      return { past: [...s.past, s.present], present: next, future: s.future.slice(1) };
    });
  }, []);

  return { doc: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
