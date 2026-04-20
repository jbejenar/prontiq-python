"use client";

import Link from "next/link";

import { useLandingAccountUrl } from "../../lib/account-url.js";
import { Button } from "../ui/button.js";

export function ConsoleLinkButton() {
  const { accountUrl, isResolved } = useLandingAccountUrl();

  if (!isResolved || !accountUrl) {
    return (
      <Button disabled size="sm" variant="outline">
        Console
      </Button>
    );
  }

  return (
    <Button asChild size="sm" variant="outline">
      <Link href={accountUrl}>Console</Link>
    </Button>
  );
}
