import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import AttachmentList from '../components/AttachmentList.jsx';
import StatusPill from '../components/StatusPill.jsx';

export default function QueryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef(null);

  async function load() {
    try {
      const data = await api.get(`/api/queries/${id}`);
      setQ(data);
      setTitle(data.title);
      setBody(data.body);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  async function saveMeta() {
    try {
      await api.patch(`/api/queries/${id}`, { title, body });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function setStatus(status) {
    try {
      await api.patch(`/api/queries/${id}`, { status });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function onPaste(e) {
    const file = [...(e.clipboardData?.files ?? [])][0];
    if (!file) return;
    e.preventDefault();
    const fd = new FormData();
    fd.append('file', file, file.name || 'pasted.png');
    try {
      const a = await api.post(`/api/queries/${id}/attachments`, fd);
      const insert = `\n![${a.filename}](/api/attachments/${a.id}/file)\n`;
      const el = bodyRef.current;
      const pos = el?.selectionStart ?? body.length;
      setBody((b) => b.slice(0, pos) + insert + b.slice(pos));
    } catch (err) {
      setError(err.message);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/api/queries/${id}/attachments`, fd);
      await load();
    } catch (err) {
      setError(err.message);
    }
    e.target.value = '';
  }

  async function addQuestion(e) {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    try {
      await api.post(`/api/queries/${id}/questions`, { text: newQuestion });
      setNewQuestion('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function moveQuestion(idx, dir) {
    const a = q.questions[idx];
    const b = q.questions[idx + dir];
    if (!b) return;
    try {
      await api.patch(`/api/questions/${a.id}`, { position: b.position });
      await api.patch(`/api/questions/${b.id}`, { position: a.position });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteQuestion(question) {
    if (!window.confirm('Delete this question (and any client attachments on it)?')) return;
    try {
      await api.delete(`/api/questions/${question.id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteQuery() {
    if (!window.confirm(`Delete query "${q.title}"?`)) return;
    try {
      await api.delete(`/api/queries/${id}`);
      navigate(`/projects/${q.project.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function regenerate() {
    if (!window.confirm('Regenerate the link? The old link will stop working.')) return;
    try {
      await api.post(`/api/queries/${id}/regenerate-token`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/s/${q.share_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (error && !q) return <p className="text-sm text-red-600">{error}</p>;
  if (!q) return null;
  const dirty = title !== q.title || body !== q.body;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={`/projects/${q.project.id}`} className="text-sm text-neutral-500 hover:text-neutral-900">
            ← {q.project.name}
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill status={q.status} />
            <span className="text-xs text-neutral-400">
              created {new Date(q.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {q.status === 'draft' && (
            <button onClick={() => setStatus('sent')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">
              Mark as sent
            </button>
          )}
          {q.status === 'sent' && (
            <button onClick={() => setStatus('closed')} className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600">
              Close
            </button>
          )}
          {q.status === 'closed' && (
            <button onClick={() => setStatus('sent')} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
              Reopen
            </button>
          )}
          <button onClick={deleteQuery} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {q.status !== 'draft' && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
          <code className="min-w-0 flex-1 truncate text-blue-900">{`${window.location.origin}/s/${q.share_token}`}</code>
          <button onClick={copyLink} className="rounded-lg bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-500">
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button onClick={regenerate} className="text-blue-700 underline-offset-2 hover:underline">
            Regenerate
          </button>
        </div>
      )}

      <section className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-lg font-semibold"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            Markdown. Paste an image to attach + insert it.
          </p>
          <button onClick={() => setPreview((v) => !v)} className="text-xs text-neutral-500 underline-offset-2 hover:underline">
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <Markdown text={body} />
          </div>
        ) : (
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={onPaste}
            rows={10}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        )}
        {dirty && (
          <button onClick={saveMeta} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Save changes
          </button>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Attachments</h2>
          <label className="cursor-pointer text-sm text-blue-700 underline-offset-2 hover:underline">
            Upload file
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" onChange={uploadFile} className="hidden" />
          </label>
        </div>
        <AttachmentList
          attachments={q.attachments}
          onDelete={async (a) => {
            try {
              await api.delete(`/api/attachments/${a.id}`);
              await load();
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Questions</h2>
        <ol className="space-y-3">
          {q.questions.map((question, idx) => (
            <li key={question.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0">
                  <span className="mr-2 font-semibold text-neutral-400">{idx + 1}.</span>
                  {question.text}
                </p>
                <span className="flex shrink-0 gap-1 text-neutral-400">
                  <button onClick={() => moveQuestion(idx, -1)} title="Move up" className="hover:text-neutral-900">↑</button>
                  <button onClick={() => moveQuestion(idx, 1)} title="Move down" className="hover:text-neutral-900">↓</button>
                  <button onClick={() => deleteQuestion(question)} title="Delete" className="hover:text-red-600">✕</button>
                </span>
              </div>
              {question.answer_text ? (
                <div className="mt-3 rounded-lg bg-green-50 p-3">
                  <p className="whitespace-pre-wrap text-sm text-green-900">{question.answer_text}</p>
                  <p className="mt-1 text-xs text-green-700">
                    answered {new Date(question.answered_at).toLocaleString()}
                  </p>
                  <div className="mt-2">
                    <AttachmentList attachments={question.attachments} />
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm italic text-neutral-400">No answer yet.</p>
              )}
            </li>
          ))}
        </ol>
        <form onSubmit={addQuestion} className="flex gap-2">
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Add a question…"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
