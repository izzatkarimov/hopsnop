import { POST_MAX_LENGTH } from "@/lib/posts";
import { COUNTER_THRESHOLD } from "./use-composer";

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type CharacterCountProps = {
  /** For the textarea's aria-describedby, once the count shows. */
  id: string;
  remaining: number;
};

/** The ring is decorative; the count is text, and only near or over the limit. */
export function CharacterCount({ id, remaining }: CharacterCountProps) {
  const used = POST_MAX_LENGTH - remaining;
  const progress = Math.min(1, Math.max(0, used / POST_MAX_LENGTH));
  const near = remaining <= COUNTER_THRESHOLD;
  const tone = remaining < 0 ? "text-danger" : near ? "text-warning" : "text-ink";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        id={id}
        aria-live="polite"
        className={`text-meta tabular-nums ${remaining < 0 ? "font-semibold" : "font-medium"} ${tone}`}
      >
        {near && (
          <>
            {remaining}
            <span className="sr-only"> characters remaining</span>
          </>
        )}
      </span>
      <svg
        viewBox="0 0 20 20"
        width={20}
        height={20}
        aria-hidden="true"
        focusable="false"
        data-tone={remaining < 0 ? "over" : near ? "near" : "ok"}
        className={`-rotate-90 ${tone}`}
      >
        <circle cx="10" cy="10" r={RADIUS} fill="none" strokeWidth={2} className="stroke-edge/12" />
        <circle
          cx="10"
          cy="10"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          className="motion-safe:transition-[stroke-dashoffset]"
        />
      </svg>
    </div>
  );
}
