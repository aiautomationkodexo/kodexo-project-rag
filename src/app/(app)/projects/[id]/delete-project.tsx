"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteProject } from "../actions";

/** Two-step, with a type-the-title confirmation. */
export function DeleteProject({
  projectId,
  title,
}: {
  projectId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  if (!open) {
    return (
      <div className="mt-section">
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete project
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-section">
      <Callout variant="err" label="Delete this project">
        <p className="mb-panel-y">
          This removes the project from search and every listing. Type the
          project title to confirm.
        </p>
        <form action={deleteProject} className="max-w-form">
          <input type="hidden" name="projectId" value={projectId} />
          <Input
            aria-label="Type the project title to confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={title}
          />
          <div className="mt-panel-y flex items-center gap-gutter">
            <SubmitButton
              variant="danger"
              pendingLabel="Deleting…"
              disabled={confirm.trim() !== title.trim()}
            >
              Delete permanently
            </SubmitButton>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Callout>
    </div>
  );
}
