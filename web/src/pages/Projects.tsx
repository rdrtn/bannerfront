import { CUSTOM_FORMAT_ID, CUSTOM_MAX_SIZE, CUSTOM_MIN_SIZE, DISPLAY_FORMATS, dimensionsLabel } from '@bannerfront/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

interface ProjectSummary {
  id: string;
  name: string;
  client: string | null;
  subject: string | null;
  kind: 'basic' | 'advanced';
  formatId: string;
  width: number;
  height: number;
  version: number;
  updatedAt: string;
}

const KIND_LABEL = { basic: 'Modo Básico', advanced: 'Modo Avançado' } as const;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function Projects() {
  const { can } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ projects: ProjectSummary[] }>('GET', `/api/projects${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setProjects(r.projects);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  async function remove(p: ProjectSummary) {
    if (!confirm(`Excluir o projeto "${p.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api('DELETE', `/api/projects/${p.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="row">
        <h1>Projetos</h1>
        <div className="spacer" />
        <input type="search" placeholder="Buscar por nome, cliente ou assunto" value={q} onChange={(e) => setQ(e.target.value)} />
        {can('projects:write') && <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Fechar' : 'Novo projeto'}</button>}
      </div>

      {creating && <NewProject onCreated={() => { setCreating(false); void load(); }} />}
      {error && <p className="error">{error}</p>}

      <div className="card">
        {projects === null ? (
          <p className="muted">Carregando…</p>
        ) : projects.length === 0 ? (
          <p className="muted">Nenhum projeto ainda.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Nome</th><th>Cliente</th><th>Tipo</th><th>Formato</th><th>Atualizado</th><th /></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}{p.subject && <div className="muted small">{p.subject}</div>}</td>
                  <td>{p.client ?? '—'}</td>
                  <td>{KIND_LABEL[p.kind]}</td>
                  <td>{dimensionsLabel(p.width, p.height)}</td>
                  <td>{fmtDate(p.updatedAt)}</td>
                  <td className="right">{can('projects:delete') && <button className="danger" onClick={() => void remove(p)}>Excluir</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">O editor visual chega na Fase 1. Por enquanto, os projetos já são criados e salvos no formato definitivo.</p>
      </div>
    </>
  );
}

function NewProject({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [subject, setSubject] = useState('');
  const [kind, setKind] = useState<'basic' | 'advanced'>('basic');
  const [formatId, setFormatId] = useState<string>(DISPLAY_FORMATS[0]!.id);
  const [width, setWidth] = useState(970);
  const [height, setHeight] = useState(250);
  const [error, setError] = useState<string | null>(null);
  const custom = formatId === CUSTOM_FORMAT_ID;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/api/projects', {
        name,
        client: client || undefined,
        subject: subject || undefined,
        kind,
        formatId,
        ...(custom ? { width, height } : {}),
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <label>Nome do projeto<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} /></label>
      <label>Cliente<input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} /></label>
      <label>Assunto <span className="muted">(só mídia avulsa)</span><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} /></label>
      <label>
        Ferramenta
        <select value={kind} onChange={(e) => setKind(e.target.value as 'basic' | 'advanced')}>
          <option value="basic">Modo Básico</option>
          <option value="advanced">Modo Avançado</option>
        </select>
      </label>
      <label>
        Formato
        <select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          {DISPLAY_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>{f.label} ({f.width}x{f.height})</option>
          ))}
          <option value={CUSTOM_FORMAT_ID}>Dimensões livres</option>
        </select>
      </label>
      {custom && (
        <div className="row">
          <label>Largura<input type="number" min={CUSTOM_MIN_SIZE} max={CUSTOM_MAX_SIZE} value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label>
          <label>Altura<input type="number" min={CUSTOM_MIN_SIZE} max={CUSTOM_MAX_SIZE} value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div><button className="primary">Criar projeto</button></div>
    </form>
  );
}
