import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#011a28", 900: "#023048", 800: "#0c578c", 700: "#12629c" },
        brand: { DEFAULT: "#2375e4", light: "#2786fd" },
        cyan: { brand: "#1bc7fa" },
        ink: "#1f2933", mute: "#5b6b79", line: "#dfe5ea", paper: "#f4f6f8",
      },
      fontFamily: { sans: ["Roboto", "system-ui", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
} satisfies Config;
