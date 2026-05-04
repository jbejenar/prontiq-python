import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { PlaygroundKeyProvider, usePlaygroundKey } from "./playground-key-provider.js";

const authState = vi.hoisted(() => ({
  value: {
    isLoaded: false,
    orgId: undefined as string | undefined,
    userId: undefined as string | undefined,
  },
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => authState.value,
}));

beforeEach(() => {
  authState.value = { isLoaded: false, orgId: undefined, userId: undefined };
});

test("does not treat initial Clerk hydration as an org switch", async () => {
  const { rerender } = render(
    <PlaygroundKeyProvider clerkEnabled>
      <ScopeProbe />
    </PlaygroundKeyProvider>,
  );

  expect(screen.getByText("scope:0")).toBeInTheDocument();

  authState.value = { isLoaded: true, orgId: "org_1", userId: "user_1" };
  rerender(
    <PlaygroundKeyProvider clerkEnabled>
      <ScopeProbe />
    </PlaygroundKeyProvider>,
  );

  await waitFor(() => expect(screen.getByText("scope:0")).toBeInTheDocument());
});

test("increments scope version after a real resolved org switch", async () => {
  authState.value = { isLoaded: true, orgId: "org_1", userId: "user_1" };
  const { rerender } = render(
    <PlaygroundKeyProvider clerkEnabled>
      <ScopeProbe />
    </PlaygroundKeyProvider>,
  );

  await waitFor(() => expect(screen.getByText("scope:0")).toBeInTheDocument());

  authState.value = { isLoaded: true, orgId: "org_2", userId: "user_1" };
  rerender(
    <PlaygroundKeyProvider clerkEnabled>
      <ScopeProbe />
    </PlaygroundKeyProvider>,
  );

  await waitFor(() => expect(screen.getByText("scope:1")).toBeInTheDocument());
});

function ScopeProbe() {
  const { scopeVersion } = usePlaygroundKey();
  return <div>scope:{scopeVersion}</div>;
}
