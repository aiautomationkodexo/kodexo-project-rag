"use client";

/** Submits the enclosing form when a select changes. Nine lines, no router. */
export function AutoSubmit({ children }: { children: React.ReactNode }) {
  return (
    <div
      onChange={(e) =>
        (e.target as HTMLElement).closest("form")?.requestSubmit()
      }
    >
      {children}
    </div>
  );
}
