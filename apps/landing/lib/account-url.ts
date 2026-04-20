import { useEffect, useState } from "react";
import { DEFAULT_ACCOUNT_URL } from "@prontiq/shared/constants";

import { env } from "./env.js";

const PRODUCTION_LANDING_HOSTS = new Set(["prontiq.dev", "www.prontiq.dev"]);
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LANDING_VERCEL_PREFIX = "prontiq-web-public";
const CONSOLE_VERCEL_PREFIX = "prontiq-web-console";

function hasValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mapLandingOriginToAccountOrigin(origin: URL): string {
  if (PRODUCTION_LANDING_HOSTS.has(origin.hostname)) {
    return DEFAULT_ACCOUNT_URL;
  }

  if (LOCALHOST_HOSTS.has(origin.hostname)) {
    return `${origin.protocol}//${origin.hostname}:3001`;
  }

  if (origin.hostname.endsWith(".vercel.app")) {
    const [label, ...rest] = origin.hostname.split(".");
    if (label?.startsWith(`${LANDING_VERCEL_PREFIX}-`)) {
      return `${origin.protocol}//${CONSOLE_VERCEL_PREFIX}${label.slice(LANDING_VERCEL_PREFIX.length)}.${rest.join(".")}`;
    }
  }

  return DEFAULT_ACCOUNT_URL;
}

type LandingAccountUrlState = {
  accountUrl: string | null;
  isResolved: boolean;
};

type InitialLandingAccountUrlStateOptions = {
  accountUrl?: string;
  deploymentEnv?: "development" | "preview" | "production";
};

function getInitialLandingAccountUrlState(
  options: InitialLandingAccountUrlStateOptions = {},
): LandingAccountUrlState {
  const accountUrlOverride = options.accountUrl ?? env.NEXT_PUBLIC_ACCOUNT_URL;
  const deploymentEnv = options.deploymentEnv ?? env.NEXT_PUBLIC_DEPLOYMENT_ENV;

  if (hasValue(accountUrlOverride)) {
    return {
      accountUrl: accountUrlOverride,
      isResolved: true,
    };
  }

  if (deploymentEnv === "production") {
    return {
      accountUrl: DEFAULT_ACCOUNT_URL,
      isResolved: true,
    };
  }

  return {
    accountUrl: null,
    isResolved: false,
  };
}

export function resolveLandingAccountUrl(currentOrigin?: string): string {
  if (hasValue(env.NEXT_PUBLIC_ACCOUNT_URL)) {
    return env.NEXT_PUBLIC_ACCOUNT_URL;
  }

  if (!hasValue(currentOrigin)) {
    return DEFAULT_ACCOUNT_URL;
  }

  try {
    return mapLandingOriginToAccountOrigin(new URL(currentOrigin));
  } catch {
    return DEFAULT_ACCOUNT_URL;
  }
}

export function useLandingAccountUrl(): LandingAccountUrlState {
  const [state, setState] = useState<LandingAccountUrlState>(() => getInitialLandingAccountUrlState());

  useEffect(() => {
    if (state.isResolved) {
      return;
    }

    setState({
      accountUrl: resolveLandingAccountUrl(window.location.origin),
      isResolved: true,
    });
  }, [state.isResolved]);

  return state;
}

export function getInitialLandingAccountUrlForTesting(): LandingAccountUrlState {
  return getInitialLandingAccountUrlState();
}

export function getInitialLandingAccountUrlForTestOptions(
  options: InitialLandingAccountUrlStateOptions,
): LandingAccountUrlState {
  return getInitialLandingAccountUrlState(options);
}
