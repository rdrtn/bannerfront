import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

interface FontItem {
  id: string;
  family: string;
  style: string;
  weight: number;
  italic: boolean;
  format: string;
  fileName: string;
  bytes: number;
  glyphCount: number;
  source: 'upload' | 'google';
}

const cssFamily = (id: string) => `bf-font-${id}`;
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} KB`;

export function Fonts() {
  const { can } = useAuth();
  const [fonts, setFonts] = useState<FontItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFonts((await api<{ fonts: FontItem[] }>('GET', '/api/fonts')).fonts);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function remove(f: FontItem) {
    if (!confirm(`Remover a fonte ${f.family} ${f.style}?`)) return;
    try {
      await api('DELETE', `/api/fonts/${f.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1>Fontes</h1>
      {can('fonts:upload') && <Upload onUploaded={load} />}
      {error && <p className="error">{error}</p>}

      {/* Carrega cada fonte como @font-face para a pré-visualização. */}
      <style>
        {(fonts ?? [])
          .map((f) => `@font-face{font-family:"${cssFamily(f.id)}";src:url("/api/fonts/${f.id}/file");font-display:swap;}`)
          .join('\n')}
      </style>

      <div className="card">
        {fonts === null ? (
          <p className="muted">Carregando…</p>
        ) : fonts.length === 0 ? (
          <p className="muted">Nenhuma fonte cadastrada.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Família</th><th>Estilo</th><th>Prévia</th><th>Arquivo</th><th>Origem</th><th /></tr>
            </thead>
            <tbody>
              {fonts.map((f) => (
                <tr key={f.id}>
                  <td>{f.family}</td>
                  <td>{f.style} <span className="muted small">({f.weight})</span></td>
                  <td style={{ fontFamily: `"${cssFamily(f.id)}"`, fontSize: 20 }}>Aa Texto de exemplo</td>
                  <td className="small">{f.format.toUpperCase()} · {kb(f.bytes)} · {f.glyphCount} glifos</td>
                  <td className="small">{f.source === 'google' ? 'Google Fonts' : 'Enviada por usuário'}</td>
                  <td className="right">{can('system:manage') && <button className="danger" onClick={() => void remove(f)}>Remover</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Upload({ onUploaded }: { onUploaded: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // currentTarget fica nulo depois do primeiro await, por isso guardamos o formulário antes.
    const formEl = e.currentTarget;
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set('licenseConfirmed', String(confirmed));
    form.set('file', file);
    try {
      const r = await api<{ font: FontItem }>('POST', '/api/fonts', form);
      setMessage({ ok: true, text: `Fonte ${r.font.family} ${r.font.style} cadastrada.` });
      setFile(null);
      setConfirmed(false);
      formEl.reset();
      await onUploaded();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <h2>Enviar fonte</h2>
      <label>
        Arquivo <span className="muted">(TTF, OTF ou WOFF, um estilo por arquivo)</span>
        <input type="file" accept=".ttf,.otf,.woff" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
      </label>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />
        <span>
          Confirmo que tenho licença para usar esta fonte em banners e vídeos e que respondo por esse uso.
          O Bannerfront incorpora a fonte (como imagem vetorial) nos arquivos exportados.
        </span>
      </label>
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
      <div><button className="primary" disabled={busy || !file}>{busy ? 'Enviando…' : 'Enviar'}</button></div>
    </form>
  );
}
