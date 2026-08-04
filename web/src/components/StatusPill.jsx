const styles = {
  draft: 'bg-neutral-100 text-neutral-600',
  sent: 'bg-blue-100 text-blue-700',
  closed: 'bg-green-100 text-green-700',
};

export default function StatusPill({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? ''}`}>
      {status}
    </span>
  );
}
