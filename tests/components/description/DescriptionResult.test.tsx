// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DescriptionResult } from '@/components/description/DescriptionResult';

const onRegenerate = vi.fn();

function mockClipboard(writeText: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

describe('DescriptionResult', () => {
  it('copia la descripción y muestra la confirmación', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <DescriptionResult
        text="Descripción de prueba"
        onRegenerate={onRegenerate}
        actionsDisabled={false}
      />
    );

    mockClipboard(writeText);

    await user.click(
      screen.getByRole('button', { name: /Copiar descripción/ })
    );

    expect(writeText).toHaveBeenCalledWith('Descripción de prueba');
    expect(
      await screen.findByText('¡Descripción copiada!')
    ).toBeInTheDocument();
  });

  it('permite copia manual cuando falla el portapapeles', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();

    render(
      <DescriptionResult
        text="Descripción de prueba"
        onRegenerate={onRegenerate}
        actionsDisabled={false}
      />
    );

    mockClipboard(writeText);

    await user.click(
      screen.getByRole('button', { name: /Copiar descripción/ })
    );

    expect(
      await screen.findByText(/Selecciona el texto y cópialo manualmente/)
    ).toBeInTheDocument();
    expect(screen.getByText('Descripción de prueba')).toBeInTheDocument();
  });

  it('ejecuta la regeneración cuando se solicita', async () => {
    const user = userEvent.setup();
    render(
      <DescriptionResult
        text="Descripción de prueba"
        onRegenerate={onRegenerate}
        actionsDisabled={false}
      />
    );

    await user.click(
      screen.getByRole('button', { name: /Regenerar descripción/ })
    );

    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('deshabilita las acciones mientras hay una solicitud en curso', () => {
    render(
      <DescriptionResult
        text="Descripción de prueba"
        onRegenerate={onRegenerate}
        actionsDisabled={true}
      />
    );

    expect(
      screen.getByRole('button', { name: /Copiar descripción/ })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Regenerar descripción/ })
    ).toBeDisabled();
  });
});
