'use client';

import { useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { CategorySelect } from '@/components/description/CategorySelect';
import { ConditionSelector } from '@/components/description/ConditionSelector';
import { DescriptionResult } from '@/components/description/DescriptionResult';
import { NegotiablePriceField } from '@/components/description/NegotiablePriceField';
import { ProductNotesField } from '@/components/description/ProductNotesField';
import { descriptionRequestSchema } from '@/features/description/schemas/description.schema';
import { generateDescription } from '@/features/description/services/descriptionApi';
import type { IDescriptionRequest } from '@/types/description';

type FormState = {
  category: IDescriptionRequest['category'] | '';
  condition: IDescriptionRequest['condition'];
  pricingType: IDescriptionRequest['pricingType'];
  userNotes: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

type SubmissionStatus = 'idle' | 'submitting' | 'success' | 'error';

const INITIAL_FORM_STATE: FormState = {
  category: '',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: '',
};

const FIELD_ERROR_MESSAGES: Record<keyof FormState, string> = {
  category: 'Selecciona una categoría.',
  condition: 'Selecciona el estado del producto.',
  pricingType: 'Selecciona si aceptas ofertas.',
  userNotes: 'Describe qué estás vendiendo (entre 3 y 500 caracteres).',
};

const VALIDATION_SUMMARY_MESSAGE =
  'Revisa los campos señalados para continuar.';

const SUCCESS_MESSAGE = '¡Descripción generada correctamente!';

function extractFieldErrors(error: z.ZodError): FormErrors {
  const errors: FormErrors = {};

  for (const issue of error.issues) {
    const key = issue.path[0] as keyof FormState | undefined;

    if (key !== undefined && !(key in errors)) {
      errors[key] = FIELD_ERROR_MESSAGES[key] ?? 'Campo inválido.';
    }
  }

  return errors;
}

export function DescriptionForm() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [generatedText, setGeneratedText] = useState<string | null>(null);
  const [lastSuccessfulRequest, setLastSuccessfulRequest] =
    useState<IDescriptionRequest | null>(null);

  const submitting = status === 'submitting';

  function updateField<K extends keyof FormState>(
    field: K,
    value: FormState[K]
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => {
      if (!(field in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const parsed = descriptionRequestSchema.safeParse(form);

    if (!parsed.success) {
      setErrors(extractFieldErrors(parsed.error));
      setStatus('error');
      setStatusMessage(VALIDATION_SUMMARY_MESSAGE);
      return;
    }

    const request: IDescriptionRequest = {
      category: parsed.data.category,
      condition: parsed.data.condition,
      pricingType: parsed.data.pricingType,
      userNotes: parsed.data.userNotes,
    };

    setErrors({});
    setStatus('submitting');
    setStatusMessage('');

    const response = await generateDescription(request);

    if (response.success) {
      setGeneratedText(response.generatedText);
      setLastSuccessfulRequest(request);
      setStatus('success');
      setStatusMessage(SUCCESS_MESSAGE);
    } else {
      setStatus('error');
      setStatusMessage(response.errorMessage);
    }
  }

  async function handleRegenerate() {
    if (submitting || !lastSuccessfulRequest) {
      return;
    }

    setStatus('submitting');
    setStatusMessage('');

    const response = await generateDescription(lastSuccessfulRequest);

    if (response.success) {
      setGeneratedText(response.generatedText);
      setStatus('success');
      setStatusMessage(SUCCESS_MESSAGE);
    } else {
      setStatus('error');
      setStatusMessage(response.errorMessage);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        <CategorySelect
          id="category"
          value={form.category}
          error={errors.category}
          onChange={(value) => updateField('category', value)}
        />
        <ConditionSelector
          id="condition"
          value={form.condition}
          error={errors.condition}
          onChange={(value) => updateField('condition', value)}
        />
        <ProductNotesField
          id="userNotes"
          value={form.userNotes}
          error={errors.userNotes}
          onChange={(value) => updateField('userNotes', value)}
        />
        <NegotiablePriceField
          id="negotiable"
          checked={form.pricingType === 'negociable'}
          onChange={(checked) =>
            updateField('pricingType', checked ? 'negociable' : 'fijo')
          }
        />
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="h-12 w-full rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {submitting ? 'Generando…' : 'Generar descripción con IA'}
        </button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-2">
        {submitting && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Generando tu descripción…
          </p>
        )}
        {status === 'error' && statusMessage && (
          <p
            role="alert"
            className="text-sm font-medium text-red-600 dark:text-red-400"
          >
            {statusMessage}
          </p>
        )}
        {status === 'success' && statusMessage && (
          <p
            role="status"
            className="text-sm font-medium text-green-700 dark:text-green-400"
          >
            {statusMessage}
          </p>
        )}
      </div>

      {generatedText === null && submitting && (
        <div
          aria-hidden="true"
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
        >
          <div className="h-5 w-40 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-700" />
          <div className="h-4 w-full rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-700" />
          <div className="h-4 w-5/6 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-700" />
          <div className="h-4 w-2/3 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-700" />
        </div>
      )}

      {generatedText !== null && (
        <DescriptionResult
          text={generatedText}
          onRegenerate={handleRegenerate}
          actionsDisabled={submitting}
        />
      )}
    </div>
  );
}
