import { DescriptionForm } from '@/components/description/DescriptionForm';

export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
          VendeFácil AI
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Genera una descripción atractiva para tu producto en segundos.
        </p>
        <div className="mt-6">
          <DescriptionForm />
        </div>
      </div>
    </main>
  );
}
