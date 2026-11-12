/** Small shared pieces for the marketing pages: availability status and the plan step list. */

export type Status = "Live" | "Partly live" | "Planned";

/** Status in words with a shape: filled (live), half (partly live), hollow (planned). Never colour alone. */
export function StatusMark({ status, className = "" }: { status: Status; className?: string }) {
  const shape = status === "Live" ? "fill" : status === "Partly live" ? "half" : "none";
  return (
    <span className={`type-label inline-flex items-center gap-2 ${status === "Planned" ? "text-fg-2" : "text-fg"} ${className}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <circle cx="6" cy="6" r="5" fill={shape === "fill" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeDasharray={shape === "none" ? "2 2" : undefined} />
        {shape === "half" && <path d="M6 1a5 5 0 0 1 0 10Z" fill="currentColor" />}
      </svg>
      {status === "Planned" ? "Planned, not available yet" : status}
    </span>
  );
}

/** The plan the engine emits for a cross-chain transfer, with who acts at each step. */
export function PlanSteps({ steps }: { steps: readonly (readonly [string, string])[] }) {
  return (
    <ol className="type-code-block overflow-x-auto border-l-2 border-primary pl-5 text-fg">
      {steps.map(([action, actor], i) => (
        <li key={action} className={`grid grid-cols-[2ch_15ch_1fr] gap-4 whitespace-nowrap py-1.5 ${actor === "USER_WALLET" ? "text-primary" : ""}`}>
          <span className="text-fg-2">{i + 1}</span><span>{action}</span><span className={actor === "USER_WALLET" ? "" : "text-fg-2"}>{actor}</span>
        </li>
      ))}
    </ol>
  );
}

