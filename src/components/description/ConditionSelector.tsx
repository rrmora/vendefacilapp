import { PRODUCT_CONDITIONS } from '@/features/description/schemas/description.schema';
import type { IDescriptionRequest } from '@/types/description';

const CONDITION_LABELS: Record<IDescriptionRequest['condition'], string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  buen_estado: 'Buen estado',
  detalles_uso: 'Con detalles de uso',
};

interface ConditionSelectorProps {
  id: string;
  value: IDescriptionRequest['condition'];
  error?: string;
  onChange: (value: IDescriptionRequest['condition']) => void;
}

export function ConditionSelector({
  id,
  value,
  error,
  onChange,
}: ConditionSelectorProps) {
  const errorId = `${id}-error`;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Estado del producto
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PRODUCT_CONDITIONS.map((condition) => (
          <label
            key={condition}
            htmlFor={`${id}-${condition}`}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <input
              id={`${id}-${condition}`}
              name="condition"
              type="radio"
              value={condition}
              checked={value === condition}
              onChange={() => onChange(condition)}
              aria-describedby={error ? errorId : undefined}
              className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
            />
            {CONDITION_LABELS[condition]}
          </label>
        ))}
      </div>
      {error && errorId && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </fieldset>
  );
}
