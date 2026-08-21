import type { RefCallback } from "react";

/** Ref callback that commits via the input's native `change` event instead
 *  of `onBlur`. `change` fires once immediately when a number input's spin
 *  buttons are clicked — which never blurs the field, so an `onBlur`-only
 *  commit silently does nothing — and once on blur after a typed edit, same
 *  as before. It does *not* fire per keystroke while typing, unlike React's
 *  `onChange` prop (aliased to the native `input` event), so this can't be
 *  done with a JSX prop — it has to attach the raw DOM event via a ref. */
export function commitOnChange<E extends HTMLInputElement>(
  onCommit: (value: string, event: Event) => void,
): RefCallback<E> {
  return (el) => {
    if (el) el.onchange = (event) => onCommit(el.value, event);
  };
}
