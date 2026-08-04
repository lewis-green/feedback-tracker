import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Dashboard() {
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [error, setError] = useState('');

  const load = () => api.get('/api/projects').then(setProjects).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function createProject(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/api/projects', { name, client_name: clientName });
      setName('');
      setClientName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!projects) return null;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Projects</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {projects.length === 0 && <li className="p-4 text-sm text-neutral-500">No projects yet.</li>}
        {projects.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`} className="flex items-center justify-between p-4 hover:bg-neutral-50">
              <div>
                <span className="font-medium">{p.name}</span>
                {p.client_name && <span className="ml-2 text-sm text-neutral-500">{p.client_name}</span>}
              </div>
              {p.unseen_answers > 0 && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {p.unseen_answers} new
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <form onSubmit={createProject} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Client name (optional)"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          Add project
        </button>
      </form>
    </div>
  );
}
