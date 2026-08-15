export function Guide({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-3">
      <span className="font-mono text-xs text-teal border border-teal w-8 h-8 flex items-center justify-center">
        {n}
      </span>
      <div>
        <div className="font-mono text-sm mb-1">{title}</div>
        <p className="font-body text-sm text-muted">{children}</p>
      </div>
    </li>
  );
}
