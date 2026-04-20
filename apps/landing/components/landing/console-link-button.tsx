"use client";

import Link from "next/link";

import { Button } from "../ui/button.js";

type ConsoleLinkButtonProps = {
  accountUrl: string;
};

export function ConsoleLinkButton({ accountUrl }: ConsoleLinkButtonProps) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={accountUrl}>Console</Link>
    </Button>
  );
}
