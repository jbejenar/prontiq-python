import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

import preset from "@prontiq/tokens/preset";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  presets: [preset],
  theme: {
    extend: {
      colors: {
        playground: {
          panel: {
            bg: "#0A1612",
            "bg-footer": "#0E1B17",
            border: "#1A2D26",
            text: "#D3D1C7",
            muted: "#888780",
            accent: "#1D9E75",
            "accent-light": "#5DCAA5",
            "accent-tab": "#142822",
            string: "#9FE1CB",
            key: "#B5D4F4",
            number: "#FAC775",
            keyword: "#ED93B1",
            danger: "#E24B4A",
            "danger-border": "#A32D2D",
          },
        },
      },
    },
  },
  plugins: [animate],
};

export default config;
