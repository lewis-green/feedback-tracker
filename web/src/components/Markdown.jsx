import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// token: when set (client share view), attachment file urls in the body get
// ?token= appended so <img> requests are authorised.
export default function Markdown({ text, token }) {
  const html = useMemo(() => {
    let raw = marked.parse(text ?? '', { async: false });
    if (token) {
      raw = raw.replaceAll(/(\/api\/attachments\/\d+\/file)/g, `$1?token=${token}`);
    }
    return DOMPurify.sanitize(raw);
  }, [text, token]);
  return (
    <div
      className="prose prose-neutral max-w-none prose-img:rounded-lg"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
