'use client';

import { useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

interface DescriptionResultProps {
  text: string;
  onRegenerate: () => void;
  actionsDisabled: boolean;
}

export function DescriptionResult({
  text,
  onRegenerate,
  actionsDisabled,
}: DescriptionResultProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);

  const copyState: CopyState =
    copiedText === text
      ? 'copied'
      : failedText === text
        ? 'failed'
        : 'idle';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setFailedText(null);
    } catch {
      setFailedText(text);
      setCopiedText(null);
    }
  }

  return (
    <section
      aria-labelledby="description-result-title"
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
    >
      <h2
        id="description-result-title"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        Descripción generada
      </h2>
      <p className="select-all whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
        {text}
      </p>
      {copyState === 'copied' && (
        <p
          role="status"
          className="text-sm font-medium text-green-700 dark:text-green-400"
        >
          ¡Descripción copiada!
        </p>
      )}
      {copyState === 'failed' && (
        <p
          role="alert"
          className="text-sm font-medium text-amber-700 dark:text-amber-400"
        >
          No se pudo copiar. Selecciona el texto y cópialo manualmente.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleCopy}
          disabled={actionsDisabled}
          className="h-12 w-full rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Copiar descripción
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={actionsDisabled}
          className="h-12 w-full rounded-lg border border-zinc-300 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Regenerar descripción
        </button>
      </div>
    </section>
  );
}
