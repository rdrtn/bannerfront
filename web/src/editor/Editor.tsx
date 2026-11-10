import { isLayerActiveAt, projectPassDurationMs, type Layer, type ProjectDocument } from '@bannerfront/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { useOutlineFonts } from './fonts';
import {
  addSlide,
  duplicateLayer,
  moveLayer,
  newLayer,
  removeLayer,
  removeSlide,
  updateLayer,
  updateSlide,
  type LayerType,
} from './ops';
import { ExportPanel, LayersPanel, ProjectPanel, Timeline, type ExportReportView, type Meta } from './Panels';
import { Properties, type FontOption } from './Properties';
import { Stage } from './Stage';
import { useHistory } from './useHistory';

interface ProjectInfo {
  id: string;
  name: string;
  client: string | null;
  subject: string | null;
  media: 'divulgacao' | 'avulsa';
  kind: 'basic' | 'advanced';
  version: number;
}

interface Loaded {
  project: ProjectInfo;
  document: ProjectDocument;
  fonts: FontOption[];
}

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    Promise.all([
      api<{ project: ProjectInfo; document: ProjectDocument }>('GET', `/api/projects/${id}`),
      api<{ fonts: FontOption[] }>('GET', '/api/fonts'),
    ])
      .then(([p, f]) => !cancelled && setData({ project: p.project, document: p.document, fonts: f.fonts }))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="center">
        <div className="card">
          <p className="error">{error}</p>
          <Link to="/projetos">← Voltar aos projetos</Link>
        </div>
      </div>
    );
  }
  if (!data) return <div className="center muted">Carregando projeto…</div>;
  if (data.project.kind !== 'basic') {
    return (
      <div className="center">
        <div className="card">
          <p>O editor do Modo Avançado ainda não existe.</p>
          <Link to="/projetos">← Voltar aos projetos</Link>
        </div>
      </div>
    );
  }
  return <EditorInner key={data.project.id} {...data} />;
}

function EditorInner({ project, document: initial, fonts: fontList }: Loaded) {
  const { can } = useAuth();
  const readOnly = !can('projects:write');
  const h = useHistory<ProjectDocument>(initial);
  const doc = h.doc;

  const [meta, setMeta] = useState<Meta>({ name: project.name, client: project.client ?? '', subject: project.subject ?? '' });
  const [saved, setSaved] = useState({ version: project.version, doc: initial, meta });
  const dirty = doc !== saved.doc || meta.name !== saved.meta.name || meta.client !== saved.meta.client || meta.subject !== saved.meta.subject;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentSlideId, setCurrentSlideId] = useState<string | null>(initial.slides[0]?.id ?? null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [tab, setTab] = useState<'props' | 'export'>('props');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string; conflict?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<ExportReportView | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const outlineFonts = useOutlineFonts(doc);
  const passMs = projectPassDurationMs(doc);
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);

  // ----- encaixe do palco na área disponível -----
  const area = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState({ width: 800, height: 400 });
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAreaSize({ width: el.clientWidth - 40, height: el.clientHeight - 40 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitZoom = Math.max(0.1, Math.min(3, areaSize.width / doc.canvas.width, areaSize.height / doc.canvas.height));
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode;

  // ----- edição -----
  const edit = useCallback((fn: (d: ProjectDocument) => ProjectDocument, coalesce?: string) => h.set(fn, coalesce), [h.set]);

  /** Um instante em que a camada está parada na tela (depois da entrada, antes da saída). */
  const restingTime = (layer: Layer): number => {
    const from = layer.timing.startMs + (layer.enter ? layer.enter.delayMs + layer.enter.durationMs : 0);
    const to = layer.timing.endMs - (layer.exit ? layer.exit.durationMs : 0);
    if (to <= from) return Math.round((layer.timing.startMs + layer.timing.endMs) / 2);
    return time >= from && time <= to ? time : Math.round((from + to) / 2);
  };

  const select = (id: string | null, jump = true) => {
    setSelectedId(id);
    if (id) {
      const layer = doc.layers.find((l) => l.id === id);
      if (layer) {
        if (layer.slideId) setCurrentSlideId(layer.slideId);
        if (jump && !isLayerActiveAt(layer, time)) {
          setPlaying(false);
          setTime(restingTime(layer));
        }
      }
      setTab('props');
    }
  };

  const addLayer = (type: Exclude<LayerType, 'image'>) => {
    if ((type === 'text' || type === 'button') && fontList.length === 0) {
      setMessage({ kind: 'error', text: 'Cadastre ao menos uma fonte (menu Fontes) antes de criar textos e botões.' });
      return;
    }
    const layer = newLayer(doc, { type, slideId: currentSlideId, fontId: fontList[0]?.id });
    edit((d) => ({ ...d, layers: [...d.layers, layer] }));
    setPlaying(false);
    setSelectedId(layer.id);
    setTime(restingTime(layer));
    setTab('props');
  };

  async function uploadImage(file: File, replaceId?: string) {
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api<{ assetId: string; asset: ProjectDocument['assets'][string] }>('POST', `/api/projects/${project.id}/assets`, form);
      if (replaceId) {
        edit((d) => ({ ...updateLayer(d, replaceId, { assetId: r.assetId }), assets: { ...d.assets, [r.assetId]: r.asset } }));
      } else {
        const layer = newLayer(doc, { type: 'image', slideId: currentSlideId, assetId: r.assetId, asset: r.asset });
        edit((d) => ({ ...d, assets: { ...d.assets, [r.assetId]: r.asset }, layers: [...d.layers, layer] }));
        setSelectedId(layer.id);
        setTime(restingTime(layer));
        setTab('props');
      }
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    }
  }

  const addSlideAction = () => {
    const r = addSlide(doc);
    edit(() => r.doc);
    setCurrentSlideId(r.slideId);
    setTime(doc.slides.reduce((end, s) => Math.max(end, s.startMs + s.durationMs), 0));
  };

  const deleteSlide = (slideId: string) => {
    const slide = doc.slides.find((s) => s.id === slideId);
    const count = doc.layers.filter((l) => l.slideId === slideId).length;
    if (!confirm(`Excluir a tela "${slide?.name}"${count ? ` e as ${count} camada(s) dela` : ''}?`)) return;
    edit((d) => removeSlide(d, slideId));
    setCurrentSlideId(doc.slides.find((s) => s.id !== slideId)?.id ?? null);
    if (selected?.slideId === slideId) setSelectedId(null);
  };

  const deleteLayer = (layerId: string) => {
    edit((d) => removeLayer(d, layerId));
    if (selectedId === layerId) setSelectedId(null);
  };

  const duplicate = (layerId: string) => {
    const r = duplicateLayer(doc, layerId);
    if (!r.newId) return;
    edit(() => r.doc);
    setSelectedId(r.newId);
  };

  // ----- salvar -----
  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly) return false;
    setSaving(true);
    setMessage(null);
    try {
      const r = await api<{ project: { version: number } }>('PUT', `/api/projects/${project.id}`, {
        name: meta.name,
        client: meta.client,
        ...(project.media === 'avulsa' ? { subject: meta.subject } : {}),
        version: saved.version,
        document: doc,
      });
      setSaved({ version: r.project.version, doc, meta });
      setMessage({ kind: 'ok', text: 'Projeto salvo.' });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setMessage({ kind: 'error', conflict: true, text: 'Este projeto foi alterado por outra pessoa. Recarregue a página para ver a versão atual (suas alterações não salvas serão perdidas).' });
      } else if (err instanceof ApiError && err.status === 422) {
        const detail = (err.body as { issues?: { message: string }[]; details?: string } | null);
        setMessage({ kind: 'error', text: [err.message, ...(detail?.issues?.map((i) => i.message) ?? []), detail?.details].filter(Boolean).join(' ') });
      } else {
        setMessage({ kind: 'error', text: errorMessage(err) });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [readOnly, project.id, project.media, meta, saved.version, doc]);

  const checkExport = async () => {
    setReportBusy(true);
    setReportError(null);
    try {
      if (dirty && !(await save())) {
        setReportError('Não foi possível salvar antes de conferir.');
        return;
      }
      const r = await api<{ report: ExportReportView }>('GET', `/api/projects/${project.id}/export/report`);
      setReport(r.report);
    } catch (err) {
      setReportError(errorMessage(err));
    } finally {
      setReportBusy(false);
    }
  };

  // ----- teclado -----
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const target = e.target as HTMLElement;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !(target as HTMLInputElement).readOnly;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) h.redo();
      else h.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      h.redo();
    } else if (readOnly || !selected) {
      return;
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate(selected.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteLayer(selected.id);
    } else if (e.key.startsWith('Arrow') && !selected.locked) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      edit((d) => updateLayer(d, selected.id, { x: selected.x + dx, y: selected.y + dy }), `${selected.id}:nudge`);
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);

  const onWarnings = useCallback((w: string[]) => setWarnings((cur) => (cur.join('\n') === w.join('\n') ? cur : w)), []);

  const fontsOk = useMemo(() => fontList, [fontList]);

  return (
    <div className="editor">
      <header className="ed-top">
        <Link to="/projetos" onClick={(e) => dirty && !confirm('Há alterações não salvas. Sair mesmo assim?') && e.preventDefault()}>← Projetos</Link>
        <strong className="ed-title">{meta.name}</strong>
        <span className={`muted small status${dirty ? ' dirty' : ''}`}>{readOnly ? 'Somente leitura' : dirty ? 'Alterações não salvas' : 'Salvo'}</span>
        <div className="spacer" />
        {!readOnly && (
          <>
            <button disabled={!h.canUndo} onClick={h.undo} title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
            <button disabled={!h.canRedo} onClick={h.redo} title="Refazer (Ctrl+Y)">↷ Refazer</button>
          </>
        )}
        <select value={zoomMode === 'fit' ? 'fit' : String(zoomMode)} onChange={(e) => setZoomMode(e.target.value === 'fit' ? 'fit' : Number(e.target.value))} title="Zoom">
          <option value="fit">Ajustar ({Math.round(fitZoom * 100)}%)</option>
          <option value="0.5">50%</option>
          <option value="1">100%</option>
          <option value="2">200%</option>
        </select>
        {!readOnly && <button className="primary" disabled={saving || !dirty} onClick={() => void save()} title="Salvar (Ctrl+S)">{saving ? 'Salvando…' : 'Salvar'}</button>}
      </header>

      {message && (
        <div className={`ed-msg ${message.kind}`}>
          {message.text}
          {message.conflict && <button onClick={() => window.location.reload()}>Recarregar</button>}
          <button className="mini" onClick={() => setMessage(null)}>×</button>
        </div>
      )}

      <div className="ed-body">
        <aside className="ed-left">
          {!readOnly && (
            <div className="add-bar">
              <button onClick={() => addLayer('text')}>+ Texto</button>
              <button onClick={() => fileInput.current?.click()}>+ Imagem</button>
              <button onClick={() => addLayer('button')}>+ Botão</button>
              <button onClick={() => addLayer('shape')}>+ Forma</button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void uploadImage(file);
                }}
              />
            </div>
          )}
          <LayersPanel
            doc={doc}
            selectedId={selectedId}
            readOnly={readOnly}
            onSelect={(id) => select(id)}
            onToggle={(id, field) => edit((d) => updateLayer(d, id, { [field]: !d.layers.find((l) => l.id === id)![field] }))}
            onMove={(id, where) => edit((d) => moveLayer(d, id, where))}
            onDuplicate={duplicate}
            onDelete={deleteLayer}
          />
        </aside>

        <section className="ed-center">
          <div className="stage-area" ref={area}>
            <Stage
              projectId={project.id}
              title={meta.name}
              doc={doc}
              fonts={outlineFonts}
              time={time}
              playing={playing}
              passMs={passMs}
              zoom={zoom}
              selectedId={selectedId}
              readOnly={readOnly}
              onSelect={(id) => select(id, false)}
              onBox={(id, box) => edit((d) => updateLayer(d, id, box))}
              onTime={setTime}
              onEnded={() => setPlaying(false)}
              onWarnings={onWarnings}
            />
          </div>
          {warnings.length > 0 && (
            <ul className="ed-warn">
              {warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
          <Timeline
            doc={doc}
            time={time}
            playing={playing}
            selectedId={selectedId}
            currentSlideId={currentSlideId}
            readOnly={readOnly}
            onTime={(ms) => {
              setPlaying(false);
              setTime(ms);
            }}
            onPlay={() => {
              if (!playing && passMs > 0 && time >= passMs - 50) setTime(0);
              setPlaying((p) => !p);
            }}
            onSelect={(id) => select(id)}
            onSlide={(id) => {
              setCurrentSlideId(id);
              const s = doc.slides.find((x) => x.id === id);
              if (s) {
                setPlaying(false);
                setTime(Math.min(passMs, s.startMs + Math.min(s.durationMs / 2, 1500)));
              }
            }}
            onAddSlide={addSlideAction}
            onRemoveSlide={deleteSlide}
            onUpdateSlide={(id, patch) => edit((d) => updateSlide(d, id, patch), `slide:${id}:${Object.keys(patch).join()}`)}
          />
        </section>

        <aside className="ed-right">
          <div className="tabs">
            <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}>{selected ? 'Camada' : 'Projeto'}</button>
            <button className={tab === 'export' ? 'on' : ''} onClick={() => setTab('export')}>Exportar</button>
          </div>
          {tab === 'export' ? (
            <ExportPanel projectId={project.id} dirty={dirty} report={report} busy={reportBusy} error={reportError} onCheck={() => void checkExport()} />
          ) : selected ? (
            <Properties
              key={selected.id}
              layer={selected}
              doc={doc}
              fonts={fontsOk}
              readOnly={readOnly}
              canTemplate={can('templates:write')}
              onChange={(patch, coalesce) => edit((d) => updateLayer(d, selected.id, patch), coalesce)}
              onUploadImage={(file) => void uploadImage(file, selected.id)}
            />
          ) : (
            <ProjectPanel
              doc={doc}
              meta={meta}
              media={project.media}
              readOnly={readOnly}
              onMeta={(patch) => setMeta((m) => ({ ...m, ...patch }))}
              onDoc={edit}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
