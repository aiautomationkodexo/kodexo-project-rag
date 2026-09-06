import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Derived controls — DESIGN.md specifies none. See button.tsx for the rules.
 *
 * An invalid control gets an n800 (emphasis) border and an err-ink message,
 * NEVER a red border: that would spend the view's red ration on every typo.
 */
const BASE =
  "w-full rounded-box border border-n300 bg-white px-cell-x py-cell-y text-ink placeholder:text-n400 disabled:bg-n100 disabled:text-n400 aria-[invalid=true]:border-n800";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${BASE} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} leading-body ${className}`} {...props} />;
}

export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${BASE} ${className}`} {...props} />;
}
