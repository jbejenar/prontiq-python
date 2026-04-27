import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tokens } from "./tokens.js";

export interface TokenArtifacts {
  mintThemeJson: string;
  sesVarsJson: string;
  tailwindPresetJs: string;
  tokensCss: string;
}

export function renderArtifacts(): TokenArtifacts {
  const dark = tokens.color.dark;
  const light = tokens.color.light;
  const darkAtmospheric = tokens.atmospheric.dark;
  const lightAtmospheric = tokens.atmospheric.light;
  const mintTheme = {
    colors: {
      primary: dark.primary.hex,
      background: dark.background.hex,
      text: dark.foreground.hex,
    },
    fonts: {
      body: tokens.font.body,
      heading: tokens.font.display,
    },
  };

  const sesVars = {
    accentColor: dark.primary.hex,
    backgroundColor: light.background.hex,
    bodyFont: tokens.font.body,
    headingFont: tokens.font.display,
  };

  const tailwindPreset = `const preset = {
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)"
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)"
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)"
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)"
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)"
        },
        surface: "hsl(var(--card) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        warn: "hsl(var(--warn) / <alpha-value>)",
        "muted-2": "hsl(var(--muted-2) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
        "surface-hover": "hsl(var(--surface-hover) / <alpha-value>)"
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"]
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      boxShadow: {
        base: "var(--shadow-base)",
        lift: "var(--shadow-lift)"
      }
    }
  }
};

export default preset;
`;

  const css = `:root {
  --background: ${light.background.hsl};
  --foreground: ${light.foreground.hsl};
  --card: ${light.card.hsl};
  --card-foreground: ${light.cardForeground.hsl};
  --popover: ${light.popover.hsl};
  --popover-foreground: ${light.popoverForeground.hsl};
  --primary: ${light.primary.hsl};
  --primary-foreground: ${light.primaryForeground.hsl};
  --secondary: ${light.secondary.hsl};
  --secondary-foreground: ${light.secondaryForeground.hsl};
  --muted: ${light.muted.hsl};
  --muted-foreground: ${light.mutedForeground.hsl};
  --accent: ${light.accent.hsl};
  --accent-foreground: ${light.accentForeground.hsl};
  --destructive: ${light.destructive.hsl};
  --destructive-foreground: ${light.destructiveForeground.hsl};
  --border: ${light.border.hsl};
  --input: ${light.input.hsl};
  --ring: ${light.ring.hsl};
  --info: ${light.info.hsl};
  --warn: ${light.warn.hsl};
  --muted-2: ${light.muted2.hsl};
  --border-strong: ${light.borderStrong.hsl};
  --surface-hover: ${light.surfaceHover.hsl};
  --accent-glow: ${lightAtmospheric.accentGlow};
  --scanline: ${lightAtmospheric.scanline};
  --radius: ${tokens.radius};
  --shadow-base: ${tokens.shadow.baseLight};
  --shadow-lift: ${tokens.shadow.liftLight};
  --color-accent: hsl(var(--accent));
  --color-background: hsl(var(--background));
  --color-surface: hsl(var(--card));
  --color-foreground: hsl(var(--foreground));
  --font-display: ${tokens.font.display};
  --font-body: ${tokens.font.body};
  --prontiq-widget-accent: hsl(var(--accent));
  --prontiq-widget-bg: hsl(var(--card));
  --prontiq-widget-border: hsl(var(--border));
  --prontiq-widget-fg: hsl(var(--foreground));
  --prontiq-widget-muted: hsl(var(--muted-foreground));
  --prontiq-widget-accent-soft: hsl(var(--accent) / 0.08);
}

.dark,
[data-theme="dark"] {
  --background: ${dark.background.hsl};
  --foreground: ${dark.foreground.hsl};
  --card: ${dark.card.hsl};
  --card-foreground: ${dark.cardForeground.hsl};
  --popover: ${dark.popover.hsl};
  --popover-foreground: ${dark.popoverForeground.hsl};
  --primary: ${dark.primary.hsl};
  --primary-foreground: ${dark.primaryForeground.hsl};
  --secondary: ${dark.secondary.hsl};
  --secondary-foreground: ${dark.secondaryForeground.hsl};
  --muted: ${dark.muted.hsl};
  --muted-foreground: ${dark.mutedForeground.hsl};
  --accent: ${dark.accent.hsl};
  --accent-foreground: ${dark.accentForeground.hsl};
  --destructive: ${dark.destructive.hsl};
  --destructive-foreground: ${dark.destructiveForeground.hsl};
  --border: ${dark.border.hsl};
  --input: ${dark.input.hsl};
  --ring: ${dark.ring.hsl};
  --info: ${dark.info.hsl};
  --warn: ${dark.warn.hsl};
  --muted-2: ${dark.muted2.hsl};
  --border-strong: ${dark.borderStrong.hsl};
  --surface-hover: ${dark.surfaceHover.hsl};
  --accent-glow: ${darkAtmospheric.accentGlow};
  --scanline: ${darkAtmospheric.scanline};
  --shadow-base: ${tokens.shadow.baseDark};
  --shadow-lift: ${tokens.shadow.liftDark};
}
`;

  return {
    mintThemeJson: `${JSON.stringify(mintTheme, null, 2)}\n`,
    sesVarsJson: `${JSON.stringify(sesVars, null, 2)}\n`,
    tailwindPresetJs: tailwindPreset,
    tokensCss: css,
  };
}

export async function writeArtifacts(): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const distDir = resolve(currentDir);
  const artifacts = renderArtifacts();

  await mkdir(distDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(distDir, "mint-theme.json"), artifacts.mintThemeJson),
    writeFile(resolve(distDir, "ses-vars.json"), artifacts.sesVarsJson),
    writeFile(resolve(distDir, "tailwind-preset.js"), artifacts.tailwindPresetJs),
    writeFile(resolve(distDir, "tokens.css"), artifacts.tokensCss),
  ]);
}
