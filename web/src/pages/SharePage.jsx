import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import AttachmentList from '../components/AttachmentList.jsx';

function AnswerBox({ token, question, readOnly, onChanged }) {
  const [text, setText] = useState(question.answer_text ?? '');
  const [state, setState] = useState('idle'); // idle | saving | saved | error
  const [message, setMessage] = useState('');
  const clientAttachments = question.attachments.filter((a) => a.uploaded_by === 'client');
  const atCap = clientAttachments.length >= 10;

  async function save() {
    setState('saving');
    setMessage('');
    try {
      await api.put(`/api/share/${token}/questions/${question.id}/answer`, { text });
      setState('saved');
      onChanged();
    } catch (err) {
      setState('error');
      setMessage(err.message);
      // 403 means the query was closed after this page loaded — reload so the
      // whole page flips to the read-only view instead of leaving a live form.
      if (err instanceof ApiError && err.status === 403) onChanged();
    }
  }

  async function attach(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setState('saving');
    setMessage('');
    try {
      await api.post(`/api/share/${token}/questions/${question.id}/attachments`, fd);
      setState('saved');
      onChanged();
    } catch (err) {
      setState('error');
      setMessage(err.message);
      if (err instanceof ApiError && err.status === 403) onChanged();
    }
    e.target.value = '';
  }

  if (readOnly) {
    return question.answer_text ? (
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-100 p-3 text-sm">{question.answer_text}</p>
    ) : (
      <p className="mt-2 text-sm italic text-neutral-400">Not answered.</p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState('idle');
        }}
        rows={3}
        maxLength={10000}
        placeholder="Type your answer…"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={state === 'saving'}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : 'Save answer'}
        </button>
        {!atCap ? (
          <label className="cursor-pointer text-sm text-blue-700 underline-offset-2 hover:underline">
            Attach file
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
              onChange={attach}
              className="hidden"
            />
          </label>
        ) : (
          <span className="text-sm text-neutral-400">Attachment limit reached</span>
        )}
        {state === 'saved' && <span className="text-sm text-green-600">Saved ✓</span>}
        {state === 'error' && <span className="text-sm text-red-600">{message || 'Failed — try again'}</span>}
      </div>
    </div>
  );
}

export default function SharePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [pageError, setPageError] = useState(null); // 'notfound' | 'network'

  const load = () =>
    api
      .get(`/api/share/${token}`)
      .then((d) => {
        setData(d);
        setPageError(null);
      })
      .catch((err) => {
        setPageError(err instanceof ApiError && err.status === 404 ? 'notfound' : 'network');
      });
  useEffect(() => {
    load();
  }, [token]);

  if (pageError === 'notfound')
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Link not found</h1>
          <p className="mt-1 text-sm text-neutral-500">
            This link is invalid or has been replaced. Ask for a fresh one.
          </p>
        </div>
      </div>
    );
  if (pageError === 'network')
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Can't reach the server</h1>
          <p className="mt-1 text-sm text-neutral-500">Check your connection and refresh the page.</p>
        </div>
      </div>
    );
  if (!data) return null;

  const { query, questions, attachments } = data;
  const closed = query.status === 'closed';

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <header>
          <p className="text-sm text-neutral-500">
            {query.project_name}
            {query.client_name ? ` · for ${query.client_name}` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{query.title}</h1>
          {closed && (
            <p className="mt-2 rounded-lg bg-neutral-200 px-3 py-2 text-sm text-neutral-700">
              This query has been closed — answers are read-only.
            </p>
          )}
        </header>

        {query.body && (
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <Markdown text={query.body} token={token} />
          </section>
        )}

        <AttachmentList attachments={attachments} token={token} />

        <section className="space-y-4">
          <h2 className="font-semibold">
            Questions <span className="text-sm font-normal text-neutral-500">— please answer each one</span>
          </h2>
          {questions.map((question, idx) => (
            <div key={question.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <p>
                <span className="mr-2 font-semibold text-neutral-400">{idx + 1}.</span>
                {question.text}
              </p>
              <AnswerBox token={token} question={question} readOnly={closed} onChanged={load} />
              {question.attachments.length > 0 && (
                <div className="mt-3">
                  <AttachmentList attachments={question.attachments} token={token} />
                </div>
              )}
            </div>
          ))}
        </section>

        <footer className="pb-8 text-center text-xs text-neutral-400">
          Answers save per question — you can come back and edit until the query is closed.
          Attachments can't be removed once added, so choose files carefully.
        </footer>
      </div>
    </div>
  );
}
