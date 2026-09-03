import type { ReactNode } from "react";

export interface StubViewProps {
  icon: ReactNode;
  title: string;
  description: string;
}

/**
 * The "Next to build" placeholder every prototype uses for a tab that isn't
 * its own dedicated screen yet (e.g. Buyer App.html's Shop/Cook/Orders/Account
 * stubs before their real screens existed). Use for any screen scheduled in
 * a later build prompt.
 */
export function StubView({ icon, title, description }: StubViewProps) {
  return (
    <div className="stub">
      <div className="ic">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="eyebrow q">Next to build</div>
    </div>
  );
}
