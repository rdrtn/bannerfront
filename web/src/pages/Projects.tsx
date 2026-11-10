import { CUSTOM_FORMAT_ID, CUSTOM_MAX_SIZE, CUSTOM_MIN_SIZE, DISPLAY_FORMATS, DIVULGACAO_FORMAT_IDS, dimensionsLabel } from '@bannerfront/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

interface ProjectSummary {
  id: string;
  name: string;
  client: string | null;
  subject: string | null;
  media: 'divulgacao' | 'avulsa';
  kind: 'basic' | 'advanced';
  formatId: string;
  width: number;
  height: number;
  version: number;
  updatedAt: string;
}

const KIND_LABEL = { basic: 'Modo Básico', advanced: 'Modo Avançado' } as const;
const MEDIA_LABEL = { divulgacao: 'Mídia de divulgação', avulsa: 'Mídia avulsa' } as const;
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
              <tr><th>Nome</th><th>Cliente</th><th>Mídia</th><th>Formato</th><th>Atualizado</th><th /></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.kind === 'basic' ? <Link to={`/projetos/${p.id}`}>{p.name}</Link> : p.name}
                    {p.subject && <div className="muted small">{p.subject}</div>}
                  </td>
                  <td>{p.client ?? '—'}</td>
                  <td>{MEDIA_LABEL[p.media]}<div className="muted small">{KIND_LABEL[p.kind]}</div></td>
                  <td>{dimensionsLabel(p.width, p.height)}</td>
                  <td>{fmtDate(p.updatedAt)}</td>
                  <td className="right">{can('projects:delete') && <button className="danger" onClick={() => void remove(p)}>Excluir</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NewProject({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [subject, setSubject] = useState('');
  const [media, setMedia] = useState<'divulgacao' | 'avulsa'>('avulsa');
  const [formatId, setFormatId] = useState<string>(DISPLAY_FORMATS[0]!.id);
  const [width, setWidth] = useState(970);
  const [height, setHeight] = useState(250);
  const [error, setError] = useState<string | null>(null);
  const custom = formatId === CUSTOM_FORMAT_ID;
  const formats = media === 'divulgacao' ? DISPLAY_FORMATS.filter((f) => (DIVULGACAO_FORMAT_IDS as readonly string[]).includes(f.id)) : DISPLAY_FORMATS;

  function changeMedia(next: 'divulgacao' | 'avulsa') {
    setMedia(next);
    if (next === 'divulgacao' && !(DIVULGACAO_FORMAT_IDS as readonly string[]).includes(formatId)) setFormatId(DIVULGACAO_FORMAT_IDS[0]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/api/projects', {
        name,
        client,
        subject: media === 'avulsa' ? subject : undefined,
        media,
        kind: 'basic',
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
      <label>
        Tipo de mídia
        <select value={media} onChange={(e) => changeMedia(e.target.value as 'divulgacao' | 'avulsa')}>
          <option value="avulsa">Mídia avulsa (qualquer formato)</option>
          <option value="divulgacao">Mídia de divulgação (Billboard, Retângulo Médio, Mobile)</option>
        </select>
      </label>
      <label>Cliente<input value={client} onChange={(e) => setClient(e.target.value)} required maxLength={120} /></label>
      {media === 'avulsa' && (
        <label>Assunto<input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={120} /></label>
      )}
      <label>
        Formato
        <select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>{f.label} ({f.width}x{f.height})</option>
          ))}
          {media === 'avulsa' && <option value={CUSTOM_FORMAT_ID}>Dimensões livres</option>}
        </select>
      </label>
      {custom && (
        <div className="row">
          <label>Largura<input type="number" min={CUSTOM_MIN_SIZE} max={CUSTOM_MAX_SIZE} value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label>
          <label>Altura<input type="number" min={CUSTOM_MIN_SIZE} max={CUSTOM_MAX_SIZE} value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted small">O projeto é criado no Modo Básico. O Modo Avançado chega numa fase posterior.</p>
      <div><button className="primary">Criar projeto</button></div>
    </form>
  );
}
