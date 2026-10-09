interface NegotiablePriceFieldProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function NegotiablePriceField({
  id,
  checked,
  onChange,
}: NegotiablePriceFieldProps) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <input
        id={id}
        name="pricingType"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
      />
      Acepto ofertas (precio negociable)
    </label>
  );
}
