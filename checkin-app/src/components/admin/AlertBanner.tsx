import { Alert } from "@mantine/core";

export type AlertTone = "success" | "error" | "info" | "warning";

const TONE_COLOR: Record<AlertTone, string> = {
  success: "green",
  error: "red",
  info: "cyan",
  warning: "yellow",
};

export interface AlertBannerProps {
  /** The message to show. Falsy → renders nothing (replaces the `{message && …}` guard). */
  message: React.ReactNode;
  /** Severity → Mantine color (success=green, error=red, info=cyan, warning=yellow). */
  tone?: AlertTone;
  title?: string;
  mb?: string | number;
}

/**
 * Shared success/error status banner for admin pages. Replaces the per-page
 * `{message && <Alert color={isError ? 'red' : 'green'}>…</Alert>}` blocks (which had drifted
 * across green/red/cyan/yellow and a `message.includes('success')` heuristic) with one tone→color
 * mapping and a built-in empty-message guard.
 */
export function AlertBanner({ message, tone = "info", title, mb }: AlertBannerProps) {
  if (!message) return null;
  return (
    <Alert color={TONE_COLOR[tone]} title={title} mb={mb}>
      {message}
    </Alert>
  );
}
