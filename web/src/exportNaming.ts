/** Filesystem-safe basename (no extension) for an exported multi-tool bin:
 *  the saved Bin Library entry's name, if there is one, else the selected
 *  tools' names — capped at 3 with a "+N more" suffix so a big selection
 *  doesn't produce an unwieldy filename. Falls back to "multitool-bin" if
 *  neither yields anything usable (e.g. every tool is unlabelled). */
export function binExportName(binLabel: string | null | undefined, toolLabels: string[]): string {
  const raw = binLabel?.trim() || joinToolNames(toolLabels);
  return sanitizeFilename(raw || "multitool-bin");
}

function joinToolNames(labels: string[]): string {
  const names = labels.map((l) => l.trim()).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

function sanitizeFilename(raw: string): string {
  return raw.replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "multitool-bin";
}
