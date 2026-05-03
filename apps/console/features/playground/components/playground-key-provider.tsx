"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";

interface HeldPlaygroundKey {
  raw: string;
  receivedAt: number;
}

interface PlaygroundKeyContextValue {
  clearHeldKey: () => void;
  heldKey: HeldPlaygroundKey | null;
  setHeldKey: (raw: string) => void;
  scopeVersion: number;
}

const PlaygroundKeyContext = createContext<PlaygroundKeyContextValue | null>(null);

function MemoryOnlyPlaygroundKeyProvider({ children }: { children: ReactNode }) {
  const [heldKey, setHeldKeyState] = useState<HeldPlaygroundKey | null>(null);
  const setHeldKey = useCallback((raw: string) => {
    setHeldKeyState({ raw, receivedAt: Date.now() });
  }, []);
  const clearHeldKey = useCallback(() => {
    setHeldKeyState(null);
  }, []);
  const value = useMemo(
    () => ({ clearHeldKey, heldKey, scopeVersion: 0, setHeldKey }),
    [clearHeldKey, heldKey, setHeldKey],
  );

  return <PlaygroundKeyContext.Provider value={value}>{children}</PlaygroundKeyContext.Provider>;
}

function ClerkScopedPlaygroundKeyProvider({ children }: { children: ReactNode }) {
  const { orgId, userId } = useAuth();
  const [heldKey, setHeldKeyState] = useState<HeldPlaygroundKey | null>(null);
  const [scope, setScope] = useState({ orgId: orgId ?? null, userId: userId ?? null });
  const [scopeVersion, setScopeVersion] = useState(0);

  useEffect(() => {
    const nextScope = { orgId: orgId ?? null, userId: userId ?? null };
    if (nextScope.orgId !== scope.orgId || nextScope.userId !== scope.userId) {
      setHeldKeyState(null);
      setScope(nextScope);
      setScopeVersion((value) => value + 1);
    }
  }, [orgId, scope.orgId, scope.userId, userId]);

  const setHeldKey = useCallback((raw: string) => {
    setHeldKeyState({ raw, receivedAt: Date.now() });
  }, []);

  const clearHeldKey = useCallback(() => {
    setHeldKeyState(null);
  }, []);

  const value = useMemo(
    () => ({ clearHeldKey, heldKey, scopeVersion, setHeldKey }),
    [clearHeldKey, heldKey, scopeVersion, setHeldKey],
  );

  return <PlaygroundKeyContext.Provider value={value}>{children}</PlaygroundKeyContext.Provider>;
}

export function PlaygroundKeyProvider({
  children,
  clerkEnabled,
}: {
  children: ReactNode;
  clerkEnabled: boolean;
}) {
  if (!clerkEnabled) return <MemoryOnlyPlaygroundKeyProvider>{children}</MemoryOnlyPlaygroundKeyProvider>;
  return <ClerkScopedPlaygroundKeyProvider>{children}</ClerkScopedPlaygroundKeyProvider>;
}

export function usePlaygroundKey() {
  const context = useContext(PlaygroundKeyContext);
  if (!context) throw new Error("usePlaygroundKey must be used inside PlaygroundKeyProvider.");
  return context;
}
