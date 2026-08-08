type RelayDirectoryErrorNoticeProps = {
  message: string;
  onRetry: () => void;
  testId: string;
};

/** Contextual recovery affordance for fail-closed shared-agent discovery. */
export function RelayDirectoryErrorNotice({
  message,
  onRetry,
  testId,
}: RelayDirectoryErrorNoticeProps) {
  return (
    <p className="pt-2 text-sm text-destructive" data-testid={testId}>
      Agent directory unavailable: {message}{" "}
      <button className="underline" onClick={onRetry} type="button">
        Retry
      </button>
    </p>
  );
}
