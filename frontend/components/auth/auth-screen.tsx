import type { ReactNode, Ref } from "react";
import { Card } from "@/components/ui/card";
import { IconShieldCheck } from "@/components/ui/icons";

type AuthCardProps = {
  children: ReactNode;
  /** The privacy line under the card. */
  note?: boolean;
};

export function AuthCard({ children, note = false }: AuthCardProps) {
  return (
    <div className="flex w-full max-w-110 flex-col items-center gap-6">
      <Card surface="shell" className="w-full">
        <Card className="p-6 sm:p-8">{children}</Card>
      </Card>
      {note && (
        <p className="flex items-center gap-2 text-center text-meta font-medium text-muted">
          <IconShieldCheck size={16} className="shrink-0 text-success" />
          No ads, no trackers. Your data stays yours.
        </p>
      )}
    </div>
  );
}

type AuthHeadingProps = {
  title: string;
  description?: ReactNode;
  /** An IconBadge; centres the heading. */
  badge?: ReactNode;
  /** Focused when the user comes back to this step. */
  headingRef?: Ref<HTMLHeadingElement>;
};

export function AuthHeading({ title, description, badge, headingRef }: AuthHeadingProps) {
  return (
    <div className={`flex flex-col gap-4 ${badge ? "items-center text-center" : ""}`}>
      {badge}
      <div className="flex flex-col gap-2">
        <h1
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="text-display font-bold text-primary"
        >
          {title}
        </h1>
        {description && <div className="text-body text-secondary">{description}</div>}
      </div>
    </div>
  );
}

type AuthScreenProps = Omit<AuthHeadingProps, "headingRef"> & {
  children: ReactNode;
  note?: boolean;
};

/** A card with a heading, for the steps that aren't a single form. */
export function AuthScreen({ title, description, badge, note, children }: AuthScreenProps) {
  return (
    <AuthCard note={note}>
      <div className="flex flex-col gap-6">
        <AuthHeading title={title} description={description} badge={badge} />
        {children}
      </div>
    </AuthCard>
  );
}
