import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

export function Account() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await api('POST', '/api/auth/change-password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setMessage({ ok: true, text: 'Senha alterada. Outras sessões abertas foram encerradas.' });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <>
      <h1>Minha conta</h1>
      <div className="card narrow">
        <p>
          <strong>{user!.name}</strong>
          <br />
          <span className="muted">{user!.email}</span>
        </p>
        <form onSubmit={submit}>
          <h2>Trocar senha</h2>
          <label>
            Senha atual
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <label>
            Nova senha <span className="muted">(mínimo de 10 caracteres)</span>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
          </label>
          {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
          <button className="primary">Alterar senha</button>
        </form>
      </div>
    </>
  );
}
