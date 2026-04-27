import type { ReactNode } from "react";

interface AppFootStripProps {
  items: readonly string[];
  trailing?: ReactNode;
}

export function AppFootStrip({ items, trailing }: AppFootStripProps) {
  if (items.length === 0 && !trailing) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
      {items.map((item, index) => (
        <span className="flex items-center gap-3" key={`${item}-${index}`}>
          <span>{item}</span>
          {index < items.length - 1 ? (
            <span aria-hidden="true" className="text-muted-2">
              ·
            </span>
          ) : null}
        </span>
      ))}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
