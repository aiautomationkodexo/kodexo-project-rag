import { Chip } from "./chip";
import type { DocumentStatus, ProjectStatus, Tone } from "@/lib/types";

/**
 * THE ONLY place a pipeline status is mapped to a colour.
 *
 * Seven states across two entities, six available tones, so two states share.
 * That is fine because the LABEL always disambiguates — a bare coloured dot
 * would not be acceptable here.
 *
 * tone-warn is DELIBERATELY UNALLOCATED. Amber reads as "this needs your
 * attention", and no normal pipeline state qualifies. Reserving it means that
 * when the document list says "1 of 4 documents failed" in a warn callout, the
 * colour still carries information. Spend warn on `finalizing` and that signal
 * is gone.
 *
 * Both ladders escalate correctly: neutral → info → ok, with err branching off.
 */
const DOCUMENT_TONES: Record<DocumentStatus, Tone> = {
  queued: "neutral", // nothing has happened yet; neutral is honest
  processing: "info", // active, not a problem
  done: "ok",
  failed: "err",
};

const PROJECT_TONES: Record<ProjectStatus, Tone> = {
  processing: "neutral",
  finalizing: "info",
  ready: "ok",
};

export function StatusChip(
  props:
    | { kind: "document"; status: DocumentStatus }
    | { kind: "project"; status: ProjectStatus },
) {
  const tone =
    props.kind === "document"
      ? DOCUMENT_TONES[props.status]
      : PROJECT_TONES[props.status];

  return <Chip tone={tone}>{props.status}</Chip>;
}
