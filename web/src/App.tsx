import type { Permission } from '@bannerfront/shared';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './pages/Layout';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { Fonts } from './pages/Fonts';
import { Users } from './pages/Users';
import { System } from './pages/System';
import { Account } from './pages/Account';
import { Creatives } from './pages/Creatives';
import { Editor } from './editor/Editor';

function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <Navigate to="/" replace />;
}

function Home() {
  const { can } = useAuth();
  return <Navigate to={can('projects:read') ? '/projetos' : '/criativos'} replace />;
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Carregando…</div>;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="projetos/:id" element={<Guard permission="projects:read"><Editor /></Guard>} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="projetos" element={<Guard permission="projects:read"><Projects /></Guard>} />
        <Route path="criativos" element={<Guard permission="creatives:read"><Creatives /></Guard>} />
        <Route path="fontes" element={<Guard permission="fonts:read"><Fonts /></Guard>} />
        <Route path="usuarios" element={<Guard permission="users:manage"><Users /></Guard>} />
        <Route path="sistema" element={<Guard permission="system:manage"><System /></Guard>} />
        <Route path="conta" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
