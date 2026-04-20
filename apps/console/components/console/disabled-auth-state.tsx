import { getClerkRuntimeMessage, type ClerkRuntimeMode } from "../../lib/clerk.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";

interface DisabledAuthStateProps {
  mode: ClerkRuntimeMode;
  missingKeys: string[];
}

export function DisabledAuthState({ mode, missingKeys }: DisabledAuthStateProps) {
  const isMisconfigured = mode === "misconfigured";

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <Badge className="w-fit" variant="outline">
          {isMisconfigured ? "Clerk misconfigured" : "Clerk disabled"}
        </Badge>
        <CardTitle className="mt-4 text-4xl">{getClerkRuntimeMessage(mode, missingKeys)}</CardTitle>
        <CardDescription className="max-w-xl leading-6">
          {isMisconfigured
            ? "This is a fail-closed configuration error. Fix the missing Clerk key(s) before expecting the protected console routes to work."
            : "This explicit helper-managed keyless mode exists only for local and CI workflows. Add both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to render the real sign-in surface and protected console shell outside that path."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          {isMisconfigured
            ? `Missing Clerk key(s): ${missingKeys.join(", ")}.`
            : "This fallback is intentional. `P1C.07` keeps fresh-checkout local and CI workflows deterministic without letting deployed environments fail open."}
        </p>
      </CardContent>
    </Card>
  );
}
