import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

// The WAI-ARIA tabs pattern: arrow keys move between tabs, Home and End jump to the ends.
export function Tabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const base = useId();
  const [active, setActive] = useState(tabs[0]?.id ?? '');

  const move = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const next = target === undefined ? undefined : tabs[target];
    if (!next) return;
    event.preventDefault();
    setActive(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  };

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => {
              setActive(tab.id);
            }}
            onKeyDown={(event) => {
              move(event, index);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
        >
          {tab.id === active ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
