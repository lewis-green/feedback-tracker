import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/api/login', { password });
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 rounded-xl bg-white p-6 shadow">
        <h1 className="text-lg font-semibold">Question Tracker</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          Log in
        </button>
      </form>
    </div>
  );
}
