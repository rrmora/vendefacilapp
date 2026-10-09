import type { ReactNode } from 'react';

interface FieldProps {
  label: ReactNode;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  hintId,
  error,
  errorId,
  children,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {children}
      {hint && !error && hintId && (
        <p id={hintId} className="text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      )}
      {error && errorId && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
