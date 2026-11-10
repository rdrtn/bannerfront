import { ROLE_LABELS, type Permission } from '@bannerfront/shared';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

const LINKS: { to: string; label: string; permission?: Permission }[] = [
  { to: '/projetos', label: 'Projetos', permission: 'projects:read' },
  { to: '/criativos', label: 'Criativos', permission: 'creatives:read' },
  { to: '/fontes', label: 'Fontes', permission: 'fonts:read' },
  { to: '/usuarios', label: 'Usuários', permission: 'users:manage' },
  { to: '/sistema', label: 'Sistema', permission: 'system:manage' },
];

export function Layout() {
  const { user, logout, can } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Bannerfront</strong>
        <nav>
          {LINKS.filter((l) => !l.permission || can(l.permission)).map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <NavLink to="/conta" className="user">
          {user!.name} <span className="muted">· {ROLE_LABELS[user!.role]}</span>
        </NavLink>
        <button onClick={() => void logout()}>Sair</button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
