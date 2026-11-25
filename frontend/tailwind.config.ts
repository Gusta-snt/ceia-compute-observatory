import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

// Cores semânticas vêm de variáveis CSS (globals.css), em triplas RGB, para que o tema escuro do
// modo quiosque troque tudo de uma vez. Hex só existe aqui e em globals.css.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const tone = (k: string) => ({ DEFAULT: v(`${k}-dot`), fg: v(`${k}-fg`), bg: v(`${k}-bg`), line: v(`${k}-line`) });

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#011a28", 900: "#023048", 800: "#0c578c", 700: "#12629c" },
        ceia: { DEFAULT: "#1c3882", dark: "#152b66" }, // azul da marca CEIA (perfil oficial)
        brand: { DEFAULT: v("action"), light: "#2786fd" },
        cyan: { brand: "#1bc7fa" },
        ink: v("ink"), mute: v("mute"), line: { DEFAULT: v("line"), strong: v("line-strong") },
        paper: v("paper"), surface: v("surface"), sunken: v("sunken"), heading: v("heading"),
        ok: tone("ok"), warn: tone("warn"), crit: tone("crit"), idle: tone("idle"), unknown: tone("unknown"),
      },
      fontSize: { label: ["13px", "16px"], stat: ["32px", "36px"] },
      fontFamily: { sans: ["Roboto", "system-ui", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      maxWidth: { content: "1440px" },
    },
  },
  plugins: [plugin(({ addVariant }) => { addVariant("coarse", "@media (pointer: coarse)"); })],
} satisfies Config;
