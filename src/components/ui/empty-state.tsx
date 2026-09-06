import { Callout } from "./callout";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Callout variant="default">
      <p className="mb-0 font-body font-bold">{title}</p>
      {body ? <div className="mt-[6px] text-small text-n500">{body}</div> : null}
      {action ? <div className="mt-panel-y">{action}</div> : null}
    </Callout>
  );
}
