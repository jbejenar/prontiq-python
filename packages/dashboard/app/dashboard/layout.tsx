import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Guard: only enforce auth when Clerk is configured
  if (process.env.CLERK_SECRET_KEY) {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");
  }
  return <>{children}</>;
}
