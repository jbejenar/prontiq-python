import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

import preset from "@prontiq/tokens/preset";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  presets: [preset],
  plugins: [animate],
};

export default config;
