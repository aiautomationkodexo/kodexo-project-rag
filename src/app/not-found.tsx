import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-doc flex-1 flex-col justify-center px-shell py-section">
      <h1 className="mb-panel-y font-display text-section font-black tracking-title">
        Not found
      </h1>
      <p className="mb-section max-w-prose text-body text-n500">
        That page does not exist, or it has been deleted.
      </p>
      <div>
        <Link href="/projects">
          <Button>Back to projects</Button>
        </Link>
      </div>
    </main>
  );
}
