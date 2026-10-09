import { Field } from '@/components/ui/field';

const MIN_LENGTH = 3;
const MAX_LENGTH = 500;
const WARNING_THRESHOLD = 480;

interface ProductNotesFieldProps {
  id: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

export function ProductNotesField({
  id,
  value,
  error,
  onChange,
}: ProductNotesFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  const describedBy = [error ? errorId : hintId, counterId]
    .filter(Boolean)
    .join(' ');
  const nearLimit = value.length >= WARNING_THRESHOLD;

  return (
    <Field
      label={
        <label
          htmlFor={id}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          ¿Qué estás vendiendo?
          <span aria-hidden="true" className="text-red-600 dark:text-red-400">
            {' '}
            *
          </span>
        </label>
      }
      hint={`Nombre, marca, modelo, precio y características (entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres).`}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <textarea
        id={id}
        name="userNotes"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        maxLength={MAX_LENGTH}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        placeholder="Ejemplo: iPhone 13 de 128 GB, batería al 85%, incluye cargador"
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <p
        id={counterId}
        className={
          nearLimit
            ? 'text-xs font-medium text-amber-600 dark:text-amber-400'
            : 'text-xs text-zinc-500 dark:text-zinc-400'
        }
      >
        {value.length}/{MAX_LENGTH}
      </p>
    </Field>
  );
}
