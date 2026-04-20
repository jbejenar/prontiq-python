import { getClerkRuntime, isConsolePublicRoute } from "./clerk.js";

test("getClerkRuntime marks auth as disabled only when keyless mode is explicitly allowed", () => {
  const runtime = getClerkRuntime({
    allowKeyless: true,
    publishableKey: undefined,
    secretKey: undefined,
  });

  expect(runtime.clerkEnabled).toBe(false);
  expect(runtime.mode).toBe("disabled");
  expect(runtime.missingKeys).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]);
});

test("getClerkRuntime treats fully missing Clerk keys as a misconfiguration when keyless mode is not allowed", () => {
  const runtime = getClerkRuntime({
    allowKeyless: false,
    publishableKey: undefined,
    secretKey: undefined,
  });

  expect(runtime.clerkEnabled).toBe(false);
  expect(runtime.mode).toBe("misconfigured");
  expect(runtime.missingKeys).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]);
});

test("getClerkRuntime treats a missing secret key as a misconfiguration", () => {
  const runtime = getClerkRuntime({ allowKeyless: true, publishableKey: "pk_test", secretKey: undefined });

  expect(runtime.clerkEnabled).toBe(false);
  expect(runtime.mode).toBe("misconfigured");
  expect(runtime.missingKeys).toEqual(["CLERK_SECRET_KEY"]);
});

test("getClerkRuntime treats a missing publishable key as a misconfiguration", () => {
  const runtime = getClerkRuntime({ allowKeyless: true, publishableKey: undefined, secretKey: "sk_test" });

  expect(runtime.clerkEnabled).toBe(false);
  expect(runtime.mode).toBe("misconfigured");
  expect(runtime.missingKeys).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]);
});

test("getClerkRuntime enables auth when both Clerk keys are present", () => {
  const runtime = getClerkRuntime({ allowKeyless: false, publishableKey: "pk_test", secretKey: "sk_test" });

  expect(runtime.clerkEnabled).toBe(true);
  expect(runtime.mode).toBe("enabled");
  expect(runtime.missingKeys).toEqual([]);
});

test("public route matcher recognizes the sign-in route family", () => {
  expect(isConsolePublicRoute("/sign-in")).toBe(true);
  expect(isConsolePublicRoute("/sign-in/sso-callback")).toBe(true);
  expect(isConsolePublicRoute("/")).toBe(false);
});
