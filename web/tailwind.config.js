/** Design tokens mapped into Tailwind. Every value is a CSS custom property
 *  (defined in index.css) so the light/dark palettes in there are the single
 *  source of truth — this file just wires the token names up. Grid/arrange
 *  tool colors are handled separately (hardcoded palettes in Library.tsx /
 *  CombineEditor.tsx) and don't live here. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      // substrates
      paper: "var(--c-paper)",
      "paper-2": "var(--c-paper-2)",
      // default body/ink text — flips with the theme
      ink: "var(--c-ink)",
      // fixed dark surface (buttons, viewport/thumbnail panels) — stays dark
      // in both themes, paired with knockout text on top of it
      field: "var(--c-field)",
      knockout: "var(--c-knockout)",
      // spot inks
      orange: "var(--c-orange)",
      "orange-text": "var(--c-orange-text)",
      red: "var(--c-red)",
      teal: "var(--c-teal)",
      gold: "var(--c-gold)",
      olive: "var(--c-olive)",
      // neutrals
      line: "var(--c-line)",
      muted: "var(--c-muted)",
    },
    fontFamily: {
      display: ['"Space Grotesk"', "sans-serif"],
      body: ['"IBM Plex Sans"', "sans-serif"],
      mono: ['"IBM Plex Mono"', "monospace"],
    },
    fontSize: {
      xs: "0.75rem",
      sm: "0.875rem",
      base: "1rem",
      lg: "1.25rem",
      xl: "1.563rem",
      "2xl": "1.953rem",
      "3xl": "2.441rem",
      "4xl": "3.052rem",
    },
    borderRadius: { none: "0", DEFAULT: "2px", full: "9999px" },
    extend: {
      spacing: { 18: "4.5rem", 22: "5.5rem" },
      maxWidth: { container: "1120px" },
    },
  },
  plugins: [],
};
