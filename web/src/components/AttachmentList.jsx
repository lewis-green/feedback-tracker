// Renders attachment thumbnails/links. token authorises client-side access.
export default function AttachmentList({ attachments, token, onDelete }) {
  if (!attachments?.length) return null;
  const url = (a) => `/api/attachments/${a.id}/file${token ? `?token=${token}` : ''}`;
  return (
    <ul className="flex flex-wrap gap-3">
      {attachments.map((a) => (
        <li key={a.id} className="group relative">
          <a href={url(a)} target="_blank" rel="noreferrer" className="block">
            {a.mime.startsWith('image/') ? (
              <img src={url(a)} alt={a.filename} className="h-24 rounded-lg border border-neutral-200 object-cover" />
            ) : (
              <span className="inline-block rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
                📄 {a.filename}
              </span>
            )}
          </a>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(a)}
              className="absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white group-hover:flex"
              title="Delete attachment"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
