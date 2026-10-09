import { PRODUCT_CATEGORIES } from '@/features/description/schemas/description.schema';
import { Field } from '@/components/ui/field';
import type { IDescriptionRequest } from '@/types/description';

const CATEGORY_LABELS: Record<IDescriptionRequest['category'], string> = {
  ropa: 'Ropa y accesorios',
  electronica: 'Electrónica',
  hogar: 'Hogar',
  vehiculos: 'Vehículos',
  otros: 'Otros',
};

interface CategorySelectProps {
  id: string;
  value: IDescriptionRequest['category'] | '';
  error?: string;
  onChange: (value: IDescriptionRequest['category']) => void;
}

export function CategorySelect({ id, value, error, onChange }: CategorySelectProps) {
  const errorId = `${id}-error`;

  return (
    <Field
      label={
        <label
          htmlFor={id}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          Categoría
          <span aria-hidden="true" className="text-red-600 dark:text-red-400">
            {' '}
            *
          </span>
        </label>
      }
      error={error}
      errorId={errorId}
    >
      <select
        id={id}
        name="category"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as IDescriptionRequest['category'])
        }
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <option value="" disabled>
          Selecciona una categoría
        </option>
        {PRODUCT_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </option>
        ))}
      </select>
    </Field>
  );
}
