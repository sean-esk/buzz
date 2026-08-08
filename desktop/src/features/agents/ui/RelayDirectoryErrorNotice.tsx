type RelayDirectoryErrorNoticeProps = {
  error: unknown;
  onRetry: () => void;
  testId: string;
};

/** Contextual recovery affordance for fail-closed shared-agent discovery. */
export function RelayDirectoryErrorNotice({
  error,
  onRetry,
  testId,
}: RelayDirectoryErrorNoticeProps) {
  if (!(error instanceof Error)) return null;
  return (
    <p className="pt-2 text-sm text-destructive" data-testid={testId}>
      Agent directory unavailable: {error.message}{" "}
      <button className="underline" onClick={onRetry} type="button">
        Retry
      </button>
    </p>
  );
}
