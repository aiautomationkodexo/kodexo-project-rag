"use client";

import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { parseLinks, MAX_LINKS_PER_PROJECT } from "@/lib/projects/links";

const PLACEHOLDER = [
  "https://example.com/case-study",
  "Aurora case study — https://example.com/aurora",
  "[Press release](https://example.com/press)",
].join("\n");

/**
 * The links paste box.
 *
 * A Textarea rather than a repeater: there is no repeater/multi-input
 * component in components/ui, building one is a real accessibility job
 * (add/remove rows, focus management after removal, stable keys), and a
 * textarea has a genuine advantage — someone with five links in a document
 * pastes once.
 *
 * THIS is the one new field that justifies useState. The parser IGNORES lines
 * with no URL, so a typo'd line vanishes silently; showing the parsed count
 * back is what makes that visible without rejecting the whole submission.
 * parseLinks is pure and O(lines) with no I/O, so running it per keystroke is
 * fine at any length a human will paste.
 */
export function LinksField({
  idPrefix,
  defaultValue,
}: {
  idPrefix: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const parsed = parseLinks(value);
  const tooMany = parsed.length > MAX_LINKS_PER_PROJECT;

  return (
    <>
      <Field
        label="Links"
        htmlFor={`${idPrefix}-links`}
        error={
          tooMany
            ? `At most ${MAX_LINKS_PER_PROJECT} links — ${parsed.length} found.`
            : undefined
        }
        hint={
          <span className="font-body text-label uppercase tracking-label text-n700">
            {parsed.length} {parsed.length === 1 ? "link" : "links"}
          </span>
        }
      >
        <Textarea
          id={`${idPrefix}-links`}
          name="links"
          rows={4}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-invalid={tooMany || undefined}
        />
      </Field>
      <p className="mt-[-6px] mb-panel-y text-small text-n500">
        One per line — a bare URL, <span className="font-mono">Title — URL</span>,
        or a markdown link. Lines without a URL are ignored. Titles are never
        generated; a link with no title shows its domain.
      </p>
    </>
  );
}
