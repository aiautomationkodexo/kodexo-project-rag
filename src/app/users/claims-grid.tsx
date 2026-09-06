"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  CLAIMS,
  CLAIM_LABELS,
  PRESETS,
  can,
  type Claim,
  type ClaimHolder,
  type PresetName,
} from "@/lib/auth/claim-set";

/**
 * The claims checkbox grid.
 *
 * Client, because the preset buttons re-tick the boxes live. It imports from
 * `claim-set` rather than `claims` — the latter is `server-only`.
 *
 * PRD §12: a checkbox is disabled for any claim the ACTOR does not hold. The
 * database enforces the same rule (the per-row `has_claim(uid, claim)` arm of
 * claims_insert/claims_delete), so this is an affordance, not the security
 * boundary — but offering a control that is guaranteed to fail is worse than
 * not offering it.
 */
export function ClaimsGrid({
  actor,
  initial,
  disabled,
}: {
  /** The signed-in user, serialized across the boundary as a plain array. */
  actor: { isSuperAdmin: boolean; claims: Claim[] };
  initial: Claim[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Set<Claim>>(new Set(initial));

  // Reconstruct the Set-based shape `can()` expects. Cheap, and it keeps the
  // predicate identical on both sides of the network.
  const holder: ClaimHolder = {
    isSuperAdmin: actor.isSuperAdmin,
    claims: new Set(actor.claims),
  };

  function toggle(claim: Claim, checked: boolean) {
    // New Set every time — the React Compiler assumes immutability, and
    // mutating in place would silently fail to re-render.
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(claim);
      else next.delete(claim);
      return next;
    });
  }

  function applyPreset(name: PresetName) {
    // Only the claims the actor may actually grant.
    setSelected(new Set(PRESETS[name].filter((c) => can(holder, c))));
  }

  return (
    <fieldset className="mb-panel-y border-0 p-0">
      <legend className="mb-[6px] font-body text-label uppercase tracking-label text-n700">
        Permissions
      </legend>

      {!disabled ? (
        <div className="mb-panel-y flex flex-wrap items-center gap-[8px]">
          <span className="text-label uppercase tracking-label text-n500">
            Preset
          </span>
          {(Object.keys(PRESETS) as PresetName[]).map((name) => (
            <Button
              key={name}
              size="sm"
              onClick={() => applyPreset(name)}
              title={`Select the ${name} permission set`}
            >
              {name}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="rounded-box border border-n200 px-panel-x py-panel-y">
        {CLAIMS.map((claim) => {
          const permitted = can(holder, claim);
          return (
            <Checkbox
              key={claim}
              name="claims"
              value={claim}
              checked={selected.has(claim)}
              disabled={disabled || !permitted}
              title={
                permitted
                  ? CLAIM_LABELS[claim]
                  : "You cannot grant a permission you do not hold yourself"
              }
              onChange={(e) => toggle(claim, e.target.checked)}
              label={CLAIM_LABELS[claim]}
              hint={claim}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
