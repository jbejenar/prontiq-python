import { getLandingClerkRuntime, getLandingClerkRuntimeMessage } from "./clerk.js";

test("landing clerk runtime is enabled when the publishable key is present", () => {
  const runtime = getLandingClerkRuntime({
    publishableKey: "pk_test_123",
  });

  expect(runtime).toEqual({
    clerkEnabled: true,
    missingKeys: [],
    mode: "enabled",
    publishableKey: "pk_test_123",
  });
  expect(getLandingClerkRuntimeMessage(runtime.mode, runtime.missingKeys)).toBe(
    "Landing signup is configured.",
  );
});

test("landing clerk runtime is disabled in explicit helper-managed keyless mode", () => {
  expect(
    getLandingClerkRuntime({
      allowKeyless: true,
    }),
  ).toEqual({
    clerkEnabled: false,
    missingKeys: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
    mode: "disabled",
    publishableKey: undefined,
  });
});

test("landing clerk runtime fails closed when the publishable key is missing outside helper mode", () => {
  const runtime = getLandingClerkRuntime({});

  expect(runtime.mode).toBe("misconfigured");
  expect(getLandingClerkRuntimeMessage(runtime.mode, runtime.missingKeys)).toContain(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  );
});
