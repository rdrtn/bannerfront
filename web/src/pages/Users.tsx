import { ROLE_LABELS, ROLES, type Role } from '@bannerfront/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
}

export function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers((await api<{ users: UserItem[] }>('GET', '/api/users')).users);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function patch(u: UserItem, body: Record<string, unknown>) {
    try {
      await api('PATCH', `/api/users/${u.id}`, body);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
    await load();
  }

  async function resetPassword(u: UserItem) {
    const password = prompt(`Nova senha para ${u.name} (mínimo de 10 caracteres):`);
    if (password) await patch(u, { password });
  }

  return (
    <>
      <div className="row">
        <h1>Usuários</h1>
        <div className="spacer" />
        <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Fechar' : 'Novo usuário'}</button>
      </div>
      {creating && <NewUser onCreated={() => { setCreating(false); void load(); }} />}
      {error && <p className="error">{error}</p>}
      <div className="card">
        {users === null ? (
          <p className="muted">Carregando…</p>
        ) : (
          <table>
            <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'inactive'}>
                  <td>{u.name}{u.id === me!.id && <span className="muted small"> (você)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} onChange={(e) => void patch(u, { role: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td>{u.active ? 'Ativo' : 'Desativado'}</td>
                  <td className="right">
                    <button onClick={() => void resetPassword(u)}>Redefinir senha</button>{' '}
                    <button onClick={() => void patch(u, { active: !u.active })}>{u.active ? 'Desativar' : 'Reativar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NewUser({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('operacional');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/api/users', { name, email, role, password });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
      <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>
        Perfil
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </label>
      <label>Senha inicial <span className="muted">(mínimo de 10 caracteres)</span><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="off" /></label>
      {error && <p className="error">{error}</p>}
      <div><button className="primary">Criar usuário</button></div>
    </form>
  );
}
