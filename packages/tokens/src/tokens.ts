export const tokens = {
  color: {
    accent: {
      dark: "#00e5a0",
      light: "#009366",
    },
    dark: {
      bg: "#0a0d0b",
      surface: "#11161d",
      text: "#e5efe9",
    },
    light: {
      bg: "#f6f4ec",
      surface: "#ffffff",
      text: "#141814",
    },
  },
  font: {
    display: "Instrument Serif, serif",
    body: "JetBrains Mono, ui-monospace, monospace",
  },
} as const;

export type Tokens = typeof tokens;
