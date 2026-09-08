import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSearch } from "@/components/ui/icon";

/**
 * The root not-found. It renders OUTSIDE the (app) group's layout, so it has
 * no rail — which is correct: a 404 can be reached signed out, and rendering
 * a rail would mean querying a user that may not exist.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-n50 px-shell py-section">
      <div className="elev-md w-full max-w-form rounded-md border border-n200 bg-white px-section py-section">
        <EmptyState
          icon={<IconSearch />}
          title="Page not found"
          body="That page does not exist, or it has been deleted."
          action={
            <Link href="/dashboard">
              <Button>Back to dashboard</Button>
            </Link>
          }
        />
      </div>
    </main>
  );
}
