import { Skeleton } from "@/components/ui/skeleton";

/**
 * Neutral full-screen loader while the first cloud comparison of a signed-in account runs.
 * Shown instead of the setup wizard so an existing user never sees onboarding for a profile
 * that is about to be restored.
 */
export function ProfileRestoreSplash() {
  return (
    <div
      className="fixed inset-0 z-[60] bg-background"
      role="status"
      aria-busy="true"
      aria-label="loading"
      data-testid="profile-restore-splash"
    >
      <div className="mx-auto max-w-lg space-y-3 px-4 pt-10">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
