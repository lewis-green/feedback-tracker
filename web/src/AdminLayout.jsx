import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from './api.js';

export default function AdminLayout() {
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/api/me')
      .then((me) => (me.admin ? setReady(true) : navigate('/login')))
      .catch(() => navigate('/login'));
  }, [navigate]);

  if (!ready) return null;
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            Question Tracker
          </Link>
          <button
            onClick={() => api.post('/api/logout').then(() => navigate('/login')).catch(() => navigate('/login'))}
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
