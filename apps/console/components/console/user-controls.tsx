"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

import { ThemeToggle } from "../theme-toggle.js";
import { Badge } from "../ui/badge.js";

interface UserControlsProps {
  clerkEnabled: boolean;
}

export function UserControls({ clerkEnabled }: UserControlsProps) {
  return (
    <div className="flex items-center gap-3">
      <ThemeToggle />
      {clerkEnabled ? (
        <>
          <OrganizationSwitcher hidePersonal />
          <UserButton afterSignOutUrl="/sign-in" />
        </>
      ) : (
        <Badge variant="outline">Auth disabled</Badge>
      )}
    </div>
  );
}
