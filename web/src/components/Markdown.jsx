import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// token: when set (client share view), attachment file urls in the body get
// ?token= appended so <img>/<a> requests are authorised. The token is only
// ever appended to exact relative /api/attachments/:id/file urls found via a
// DOM walk over the already-sanitized markup — never via string replacement
// (which could leak the token into external urls, code spans, or prose), and
// never before sanitization (which could let a crafted src/href re-introduce
// something DOMPurify would otherwise have stripped).
export default function Markdown({ text, token }) {
  const html = useMemo(() => {
    const clean = DOMPurify.sanitize(marked.parse(text ?? '', { async: false, breaks: true }), {
      FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select'],
    });
    if (!token) return clean;
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    for (const el of tpl.content.querySelectorAll('[src], [href]')) {
      for (const attr of ['src', 'href']) {
        const v = el.getAttribute(attr);
        if (v && /^\/api\/attachments\/\d+\/file$/.test(v)) {
          el.setAttribute(attr, `${v}?token=${encodeURIComponent(token)}`);
        }
      }
    }
    return tpl.innerHTML;
  }, [text, token]);
  return (
    <div
      className="prose prose-neutral max-w-none prose-img:rounded-lg"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
