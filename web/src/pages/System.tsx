import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api';

interface Info {
  counts: { users: number; projects: number; fonts: number; activeSessions: number };
  disk: { fontsBytes: number; tempBytes: number };
}
interface AuditEntry {
  id: number;
  action: string;
  entity: string | null;
  userName: string | null;
  createdAt: string;
}

const mb = (b: number) => `${(b / 1_000_000).toFixed(1)} MB`;

export function System() {
  const [info, setInfo] = useState<Info | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api<Info>('GET', '/api/system/info'));
      setAudit((await api<{ entries: AuditEntry[] }>('GET', '/api/audit')).entries);
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function clearTemp() {
    try {
      const r = await api<{ freedBytes: number; expiredSessionsRemoved: number }>('POST', '/api/system/clear-temp');
      setMessage({ ok: true, text: `Liberados ${mb(r.freedBytes)}; ${r.expiredSessionsRemoved} sessões vencidas removidas.` });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <>
      <h1>Sistema</h1>
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
      {info && (
        <div className="card">
          <p>
            {info.counts.users} usuários · {info.counts.projects} projetos · {info.counts.fonts} fontes · {info.counts.activeSessions} sessões ativas
          </p>
          <p className="muted">Fontes em disco: {mb(info.disk.fontsBytes)} · Arquivos temporários: {mb(info.disk.tempBytes)}</p>
          <button onClick={() => void clearTemp()}>Limpar temporários</button>
        </div>
      )}
      <div className="card">
        <h2>Registro de atividades <span className="muted small">(últimas 200)</span></h2>
        <table>
          <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th></tr></thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="small">{new Date(a.createdAt).toLocaleString('pt-BR')}</td>
                <td>{a.userName ?? '—'}</td>
                <td>{a.action}{a.entity && <span className="muted small"> · {a.entity}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
