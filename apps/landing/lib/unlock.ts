export const LANDING_UNLOCK_COOKIE_NAME = "prontiq_landing_unlock";
export const LANDING_UNLOCK_QUERY_PARAM = "unlock";
export const LANDING_UNLOCK_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type UnlockDecision =
  | { kind: "allow" }
  | { kind: "redirect"; shouldSetCookie: boolean }
  | { kind: "locked" };

type EvaluateLandingUnlockOptions = {
  configuredToken?: string;
  cookieToken?: string;
  queryToken?: string | null;
};

export function evaluateLandingUnlock({
  configuredToken,
  cookieToken,
  queryToken,
}: EvaluateLandingUnlockOptions): UnlockDecision {
  if (!hasValue(configuredToken)) {
    return { kind: "allow" };
  }

  if (cookieToken === configuredToken) {
    return { kind: "allow" };
  }

  if (queryToken !== undefined && queryToken !== null) {
    return {
      kind: "redirect",
      shouldSetCookie: queryToken === configuredToken,
    };
  }

  return { kind: "locked" };
}

export function createLockedPageHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>Prontiq</title>",
    "    <style>",
    "      :root { color-scheme: dark; }",
    "      * { box-sizing: border-box; }",
    "      html, body { margin: 0; min-height: 100%; background: #000; }",
    "      body { min-height: 100vh; }",
    "    </style>",
    "  </head>",
    "  <body></body>",
    "</html>",
  ].join("");
}

function hasValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
