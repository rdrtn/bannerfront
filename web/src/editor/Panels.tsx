import {
  checkProject,
  dimensionsLabel,
  projectPassDurationMs,
  projectTotalDurationMs,
  type Layer,
  type ProjectDocument,
} from '@bannerfront/shared';
import { useState } from 'react';
import { ColorField, NumField, SelectField } from './fields';
import { TYPE_LABEL, fmtSeconds } from './ops';

// ---------------------------------------------------------------------------
// Camadas
// ---------------------------------------------------------------------------

interface LayersProps {
  doc: ProjectDocument;
  selectedId: string | null;
  readOnly: boolean;
  onSelect(id: string): void;
  onToggle(id: string, field: 'visible' | 'locked'): void;
  onMove(id: string, where: 'up' | 'down' | 'top' | 'bottom'): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
}

export function LayersPanel(p: LayersProps) {
  const ordered = [...p.doc.layers].reverse(); // de cima para baixo
  const slideName = (id: string | null) => p.doc.slides.find((s) => s.id === id)?.name;
  return (
    <div className="layers">
      <h3>Camadas</h3>
      {ordered.length === 0 && <p className="muted small">Nenhuma camada. Use os botões acima para adicionar texto, imagem, botão ou forma.</p>}
      <ul>
        {ordered.map((l) => (
          <li key={l.id} className={l.id === p.selectedId ? 'on' : ''}>
            <button className="icon" title={l.visible ? 'Ocultar' : 'Mostrar'} disabled={p.readOnly} onClick={() => p.onToggle(l.id, 'visible')}>
              {l.visible ? '👁' : '—'}
            </button>
            <button className="icon" title={l.locked ? 'Destravar' : 'Travar'} disabled={p.readOnly} onClick={() => p.onToggle(l.id, 'locked')}>
              {l.locked ? '🔒' : '🔓'}
            </button>
            <button className="name" onClick={() => p.onSelect(l.id)}>
              <span className={`tag t-${l.type}`}>{TYPE_LABEL[l.type]}</span> {l.name}
              {slideName(l.slideId) && <small className="muted"> · {slideName(l.slideId)}</small>}
            </button>
          </li>
        ))}
      </ul>
      {p.selectedId && !p.readOnly && (
        <div className="layer-actions">
          <button title="Trazer para frente" onClick={() => p.onMove(p.selectedId!, 'up')}>↑</button>
          <button title="Enviar para trás" onClick={() => p.onMove(p.selectedId!, 'down')}>↓</button>
          <button title="Para o topo" onClick={() => p.onMove(p.selectedId!, 'top')}>⤒</button>
          <button title="Para o fundo" onClick={() => p.onMove(p.selectedId!, 'bottom')}>⤓</button>
          <button onClick={() => p.onDuplicate(p.selectedId!)}>Duplicar</button>
          <button className="danger" onClick={() => p.onDelete(p.selectedId!)}>Excluir</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha do tempo: telas, régua e barras das camadas
// ---------------------------------------------------------------------------

interface TimelineProps {
  doc: ProjectDocument;
  time: number;
  playing: boolean;
  selectedId: string | null;
  currentSlideId: string | null;
  readOnly: boolean;
  onTime(ms: number): void;
  onPlay(): void;
  onSelect(id: string): void;
  onSlide(id: string): void;
  onAddSlide(): void;
  onRemoveSlide(id: string): void;
  onUpdateSlide(id: string, patch: { name?: string; startMs?: number; durationMs?: number }): void;
}

export function Timeline(p: TimelineProps) {
  const pass = Math.max(1000, projectPassDurationMs(p.doc));
  const pct = (ms: number) => `${(Math.min(ms, pass) / pass) * 100}%`;
  const current = p.doc.slides.find((s) => s.id === p.currentSlideId);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    p.onTime(Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * pass));
  };

  return (
    <div className="timeline">
      <div className="tl-head">
        <button className="primary" onClick={p.onPlay}>{p.playing ? 'Pausar' : 'Reproduzir'}</button>
        <input
          type="range"
          min={0}
          max={pass}
          step={10}
          value={Math.min(p.time, pass)}
          onChange={(e) => p.onTime(Number(e.target.value))}
          className="scrub"
        />
        <span className="muted small time">{fmtSeconds(p.time)} / {fmtSeconds(pass)} s</span>
      </div>

      <div className="tl-body">
        <div className="tl-row slides" onClick={seek}>
          {p.doc.slides.map((s) => (
            <button
              key={s.id}
              className={`bar slide${s.id === p.currentSlideId ? ' on' : ''}`}
              style={{ left: pct(s.startMs), width: `${(Math.min(s.durationMs, pass - s.startMs) / pass) * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                p.onSlide(s.id);
              }}
              title={`${s.name}: ${fmtSeconds(s.startMs)}–${fmtSeconds(s.startMs + s.durationMs)} s`}
            >
              {s.name}
            </button>
          ))}
        </div>
        {[...p.doc.layers].reverse().map((l) => (
          <div key={l.id} className="tl-row" onClick={seek}>
            <button
              className={`bar layer t-${l.type}${l.id === p.selectedId ? ' on' : ''}${l.visible ? '' : ' off'}`}
              style={{ left: pct(l.timing.startMs), width: `${(Math.max(0, Math.min(l.timing.endMs, pass) - l.timing.startMs) / pass) * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                p.onSelect(l.id);
              }}
              title={`${l.name}: ${fmtSeconds(l.timing.startMs)}–${fmtSeconds(l.timing.endMs)} s`}
            >
              {l.name}
            </button>
          </div>
        ))}
        <div className="playhead" style={{ left: pct(p.time) }} />
      </div>

      <div className="tl-slides">
        {!p.readOnly && <button onClick={p.onAddSlide}>+ Tela</button>}
        {current && (
          <>
            <label className="inline">
              Nome
              <input value={current.name} maxLength={120} disabled={p.readOnly} onChange={(e) => e.target.value && p.onUpdateSlide(current.id, { name: e.target.value })} />
            </label>
            <label className="inline">
              Início
              <input type="number" min={0} step={0.1} disabled={p.readOnly} value={current.startMs / 1000} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && p.onUpdateSlide(current.id, { startMs: Math.round(e.target.valueAsNumber * 1000) })} /> s
            </label>
            <label className="inline">
              Duração
              <input type="number" min={0.1} step={0.1} disabled={p.readOnly} value={current.durationMs / 1000} onChange={(e) => e.target.valueAsNumber > 0 && p.onUpdateSlide(current.id, { durationMs: Math.round(e.target.valueAsNumber * 1000) })} /> s
            </label>
            {!p.readOnly && <button className="danger" onClick={() => p.onRemoveSlide(current.id)}>Excluir tela</button>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projeto (nada selecionado)
// ---------------------------------------------------------------------------

export interface Meta {
  name: string;
  client: string;
  subject: string;
}

interface ProjectPanelProps {
  doc: ProjectDocument;
  meta: Meta;
  media: 'divulgacao' | 'avulsa';
  readOnly: boolean;
  onMeta(patch: Partial<Meta>): void;
  onDoc(patch: (doc: ProjectDocument) => ProjectDocument, coalesce?: string): void;
}

export function ProjectPanel({ doc, meta, media, readOnly, onMeta, onDoc }: ProjectPanelProps) {
  const total = projectTotalDurationMs(doc);
  const pass = projectPassDurationMs(doc);
  const issues = checkProject(doc);
  return (
    <fieldset className="props" disabled={readOnly}>
      <section className="sec">
        <h3>Projeto</h3>
        <div className="fields">
          <label className="f wide"><span>Nome</span><input value={meta.name} maxLength={160} onChange={(e) => onMeta({ name: e.target.value })} /></label>
          <label className="f wide"><span>Cliente</span><input value={meta.client} maxLength={120} onChange={(e) => onMeta({ client: e.target.value })} /></label>
          {media === 'avulsa' && (
            <label className="f wide"><span>Assunto</span><input value={meta.subject} maxLength={120} onChange={(e) => onMeta({ subject: e.target.value })} /></label>
          )}
          <p className="muted small wide">Tamanho: {dimensionsLabel(doc.canvas.width, doc.canvas.height)} (não muda depois de criado).</p>
          <ColorField label="Cor de fundo" value={doc.canvas.background} onChange={(v) => onDoc((d) => ({ ...d, canvas: { ...d.canvas, background: v } }), 'bg')} />
        </div>
      </section>

      <section className="sec">
        <h3>Repetição</h3>
        <div className="fields">
          <SelectField
            label="Loop"
            value={doc.loop.mode}
            options={[
              { value: 'count', label: 'Número de vezes' },
              { value: 'infinite', label: 'Infinito' },
            ]}
            onChange={(v) => onDoc((d) => ({ ...d, loop: v === 'infinite' ? { mode: 'infinite' } : { mode: 'count', count: 3 } }))}
          />
          {doc.loop.mode === 'count' && (
            <NumField
              label="Vezes"
              value={doc.loop.count}
              min={1}
              max={99}
              onChange={(v) => v >= 1 && onDoc((d) => ({ ...d, loop: { mode: 'count', count: Math.round(v) } }), 'loop')}
            />
          )}
          <p className="muted small wide">
            Uma passada: {fmtSeconds(pass)} s{total !== null ? ` · total: ${fmtSeconds(total)} s` : ' · loop infinito'}. Boa prática: até 15 s no total.
          </p>
        </div>
      </section>

      {issues.length > 0 && (
        <section className="sec">
          <h3>Avisos</h3>
          <ul className="issues">
            {issues.map((i, n) => (
              <li key={n} className={i.severity}>{i.message}</li>
            ))}
          </ul>
        </section>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

export interface ExportReportView {
  ok: boolean;
  errors: string[];
  warnings: string[];
  zipName: string | null;
  files: { name: string; bytes: number }[];
  totalBytes: number;
  maxBytes: number;
  overBudget: boolean;
  imageQuality: number | null;
  passMs: number;
  totalDurationMs: number | null;
}

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1).replace('.', ',')} KB`;

interface ExportProps {
  projectId: string;
  dirty: boolean;
  report: ExportReportView | null;
  busy: boolean;
  error: string | null;
  onCheck(): void;
}

export function ExportPanel({ projectId, dirty, report, busy, error, onCheck }: ExportProps) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="props">
      <section className="sec">
        <h3>Exportar HTML5 (ZIP)</h3>
        <p className="muted small">A conferência usa a versão salva do projeto{dirty ? ' — há alterações não salvas, elas serão salvas antes.' : '.'}</p>
        <button className="primary" disabled={busy} onClick={onCheck}>{busy ? 'Conferindo…' : 'Conferir peso e avisos'}</button>
        {error && <p className="error">{error}</p>}
      </section>

      {report && (
        <section className="sec">
          {report.errors.map((e, i) => <p key={i} className="error">{e}</p>)}
          {report.warnings.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}
          {report.files.length > 0 && (
            <>
              <div className={`weight${report.overBudget ? ' over' : ''}`}>
                <div className="bar-bg"><div className="bar-fg" style={{ width: `${Math.min(100, (report.totalBytes / report.maxBytes) * 100)}%` }} /></div>
                <p>
                  <strong>{kb(report.totalBytes)}</strong> de {kb(report.maxBytes)} permitidos
                  {report.overBudget ? ' — acima do limite' : ' — dentro do limite'}
                </p>
              </div>
              <table className="files">
                <tbody>
                  {report.files.map((f) => (
                    <tr key={f.name}><td>{f.name}</td><td className="right">{kb(f.bytes)}</td></tr>
                  ))}
                </tbody>
              </table>
              {report.imageQuality !== null && report.imageQuality < 88 && (
                <p className="muted small">As imagens foram comprimidas (qualidade {report.imageQuality}) para caber no limite.</p>
              )}
            </>
          )}
          {report.zipName && (
            <>
              {report.overBudget && (
                <label className="check small">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  Entendo que o arquivo passa do limite de peso do formato e quero baixar mesmo assim.
                </label>
              )}
              <a
                className={`btn primary${report.overBudget && !confirmed ? ' disabled' : ''}`}
                href={`/api/projects/${projectId}/export/download`}
                download
                onClick={(e) => report.overBudget && !confirmed && e.preventDefault()}
              >
                Baixar {report.zipName}.zip
              </a>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export function layerLabel(layer: Layer): string {
  return `${TYPE_LABEL[layer.type]} · ${layer.name}`;
}
