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
  const mintTheme = {
    colors: {
      primary: tokens.color.accent.dark,
      background: tokens.color.dark.bg,
      text: tokens.color.dark.text,
    },
    fonts: {
      body: tokens.font.body,
      heading: tokens.font.display,
    },
  };

  const sesVars = {
    accentColor: tokens.color.accent.dark,
    backgroundColor: tokens.color.light.bg,
    bodyFont: tokens.font.body,
    headingFont: tokens.font.display,
  };

  const tailwindPreset = `const preset = {
  theme: {
    extend: {
      colors: {
        accent: "var(--color-accent)",
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        foreground: "var(--color-foreground)"
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"]
      }
    }
  }
};

export default preset;
`;

  const css = `:root {
  --color-accent: ${tokens.color.accent.dark};
  --color-background: ${tokens.color.dark.bg};
  --color-surface: ${tokens.color.dark.surface};
  --color-foreground: ${tokens.color.dark.text};
  --font-display: ${tokens.font.display};
  --font-body: ${tokens.font.body};
}

[data-theme="light"] {
  --color-accent: ${tokens.color.accent.light};
  --color-background: ${tokens.color.light.bg};
  --color-surface: ${tokens.color.light.surface};
  --color-foreground: ${tokens.color.light.text};
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
