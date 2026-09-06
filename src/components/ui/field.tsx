export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-panel-y">
      <div className="mb-[6px] flex items-baseline justify-between gap-gutter">
        <label
          htmlFor={htmlFor}
          className="font-body text-label uppercase tracking-label text-n700"
        >
          {label}
          {required ? <span className="text-n400"> *</span> : null}
        </label>
        {hint}
      </div>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          className="mt-[6px] mb-0 text-small text-err-ink"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
