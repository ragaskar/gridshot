import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface BinNotesProps {
  value: string;
  /** Fires on every keystroke — the caller updates its own state (and pushes
   *  a coalesced undo snapshot) so undo/redo covers note edits. */
  onChange: (next: string) => void;
  /** Fires once, on blur, so the caller can flush an immediate save instead
   *  of waiting out the typing-stopped debounce. */
  onBlurCommit: () => void;
}

/** Freeform per-bin notes, rendered as GitHub-flavored markdown until
 *  clicked (anywhere but a link), then swapped for a plain textarea; blur
 *  (or tabbing out) swaps back to the rendered view. Saving itself is the
 *  caller's job (`onChange`/`onBlurCommit`) — this component only owns the
 *  view/edit toggle. */
export function BinNotes({ value, onChange, onBlurCommit }: BinNotesProps) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function startEditing(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("a")) return; // let the link click through
    setEditing(true);
  }

  function handleBlur() {
    setEditing(false);
    onBlurCommit();
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <span className="font-mono text-[10px] uppercase text-muted">Notes</span>
      {editing ? (
        <textarea
          ref={textareaRef}
          aria-label="Bin notes"
          className="mono-input mt-1 w-full resize-y !text-sm"
          style={{ minHeight: 140 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="Freeform notes for this bin — GitHub-flavored markdown."
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label="Bin notes — click to edit"
          className="bin-notes mt-1 min-h-[2.75rem] cursor-text border border-transparent px-2 py-2 hover:border-line"
          style={{ borderRadius: 2 }}
          onClick={startEditing}
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest("a")) return; // let the link's own Enter/Space through
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); }
          }}
        >
          {value.trim() ? (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node: _node, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {value}
            </Markdown>
          ) : (
            <span className="font-mono text-[10px] text-muted">Click to add notes…</span>
          )}
        </div>
      )}
    </div>
  );
}
