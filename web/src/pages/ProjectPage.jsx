import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const load = () => api.get(`/api/projects/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]);

  async function createQuery(e) {
    e.preventDefault();
    try {
      const q = await api.post(`/api/projects/${id}/queries`, { title });
      navigate(`/queries/${q.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteProject() {
    if (!window.confirm(`Delete project "${data.project.name}" and all its queries?`)) return;
    try {
      await api.delete(`/api/projects/${id}`);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;
  const { project, queries } = data;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          {project.client_name && <p className="text-sm text-neutral-500">Client: {project.client_name}</p>}
        </div>
        <button onClick={deleteProject} className="text-sm text-red-500 hover:text-red-700">
          Delete project
        </button>
      </div>
      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {queries.length === 0 && <li className="p-4 text-sm text-neutral-500">No queries yet.</li>}
        {queries.map((q) => (
          <li key={q.id}>
            <Link to={`/queries/${q.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-neutral-50">
              <div className="min-w-0">
                <span className="font-medium">{q.title}</span>
                <p className="text-xs text-neutral-500">
                  {q.answered_count}/{q.question_count} answered ·{' '}
                  {new Date(q.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {q.unseen_answers > 0 && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                    {q.unseen_answers} new
                  </span>
                )}
                <StatusPill status={q.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <form onSubmit={createQuery} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New query title"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          New query
        </button>
      </form>
    </div>
  );
}
