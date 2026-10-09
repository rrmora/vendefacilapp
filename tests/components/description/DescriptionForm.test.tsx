// @vitest-environment happy-dom

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DescriptionForm } from '@/components/description/DescriptionForm';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DescriptionForm', () => {
  it('renderiza exactamente cuatro campos visibles', () => {
    render(<DescriptionForm />);

    expect(
      screen.getByRole('combobox', { name: /categoría/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Buen estado' })
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Nuevo' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Como nuevo' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Con detalles de uso' })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Qué estás vendiendo/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Acepto ofertas/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    ).toBeInTheDocument();
  });

  it('muestra el estado predeterminado del formulario', () => {
    render(<DescriptionForm />);

    expect(
      screen.getByRole('radio', { name: 'Buen estado' })
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Acepto ofertas/ })
    ).not.toBeChecked();
    expect(screen.getByText('0/500')).toBeInTheDocument();
  });

  it('muestra errores de validación al enviar el formulario vacío', async () => {
    const user = userEvent.setup();
    render(<DescriptionForm />);

    await user.click(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    );

    expect(
      await screen.findByText('Selecciona una categoría.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Describe qué estás vendiendo/)
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('genera y muestra la descripción con éxito', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        success: true,
        generatedText: '[MOCK] Descripción de prueba',
        tokensUsed: null,
      })
    );

    const user = userEvent.setup();
    render(<DescriptionForm />);

    await user.selectOptions(screen.getByRole('combobox'), 'electronica');
    await user.type(
      screen.getByLabelText(/Qué estás vendiendo/),
      'iPhone 13 de 128 GB'
    );
    await user.click(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    );

    expect(
      await screen.findByText('Descripción generada')
    ).toBeInTheDocument();
    expect(
      screen.getByText('[MOCK] Descripción de prueba')
    ).toBeInTheDocument();

    const callBody = fetchMock.mock.calls[0][1].body as string;
    expect(JSON.parse(callBody)).toMatchObject({
      category: 'electronica',
      condition: 'buen_estado',
      pricingType: 'fijo',
      userNotes: 'iPhone 13 de 128 GB',
    });
  });

  it('envía precio negociable cuando el checkbox está marcado', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        success: true,
        generatedText: '[MOCK] Descripción de prueba',
        tokensUsed: null,
      })
    );

    const user = userEvent.setup();
    render(<DescriptionForm />);

    await user.selectOptions(screen.getByRole('combobox'), 'hogar');
    await user.type(
      screen.getByLabelText(/Qué estás vendiendo/),
      'Mesa de madera maciza'
    );
    await user.click(screen.getByRole('checkbox', { name: /Acepto ofertas/ }));
    await user.click(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const callBody = fetchMock.mock.calls[0][1].body as string;
    expect(JSON.parse(callBody).pricingType).toBe('negociable');
  });

  it('deshabilita la acción mientras se procesa la solicitud', async () => {
    let resolveFetch: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const user = userEvent.setup();
    render(<DescriptionForm />);

    await user.selectOptions(screen.getByRole('combobox'), 'electronica');
    await user.type(
      screen.getByLabelText(/Qué estás vendiendo/),
      'iPhone 13 de 128 GB'
    );
    await user.click(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    );

    const submitButton = screen.getByRole('button', { name: /Generando/ });
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/Generando tu descripción/)).toBeInTheDocument();

    resolveFetch!(
      Response.json({
        success: true,
        generatedText: 'Texto de resultado',
        tokensUsed: null,
      })
    );

    await waitFor(() =>
      expect(screen.getByText('Texto de resultado')).toBeInTheDocument()
    );
  });

  it('muestra el mensaje de error sin eliminar los datos del formulario', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          success: false,
          generatedText: '',
          tokensUsed: null,
          errorCode: 'PROVIDER_UNAVAILABLE',
          errorMessage: 'Servicio temporalmente no disponible.',
        },
        { status: 503 }
      )
    );

    const user = userEvent.setup();
    render(<DescriptionForm />);

    await user.selectOptions(screen.getByRole('combobox'), 'electronica');
    const notes = screen.getByLabelText(/Qué estás vendiendo/);
    await user.type(notes, 'iPhone 13 de 128 GB');
    await user.click(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    );

    expect(
      await screen.findByText('Servicio temporalmente no disponible.')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Qué estás vendiendo/)
    ).toHaveValue('iPhone 13 de 128 GB');
    expect(
      screen.getByRole('combobox', { name: /categoría/i })
    ).toHaveValue('electronica');
  });

  it('regenera utilizando la última solicitud exitosa', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        success: true,
        generatedText: 'Texto de prueba',
        tokensUsed: null,
      })
    );

    const user = userEvent.setup();
    render(<DescriptionForm />);

    await user.selectOptions(screen.getByRole('combobox'), 'electronica');
    await user.type(
      screen.getByLabelText(/Qué estás vendiendo/),
      'iPhone 13 de 128 GB'
    );
    await user.click(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    );

    expect(await screen.findByText('Texto de prueba')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Regenerar descripción/ })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse(call[1].body as string)
    );
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it('conserva la descripción anterior cuando la regeneración falla', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          generatedText: 'Primera descripción',
          tokensUsed: null,
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            success: false,
            generatedText: '',
            tokensUsed: null,
            errorCode: 'PROVIDER_UNAVAILABLE',
            errorMessage: 'Servicio temporalmente no disponible.',
          },
          { status: 503 }
        )
      );

    const user = userEvent.setup();
    render(<DescriptionForm />);

    await user.selectOptions(screen.getByRole('combobox'), 'electronica');
    await user.type(
      screen.getByLabelText(/Qué estás vendiendo/),
      'iPhone 13 de 128 GB'
    );
    await user.click(
      screen.getByRole('button', { name: /Generar descripción con IA/ })
    );

    expect(await screen.findByText('Primera descripción')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Regenerar descripción/ })
    );

    expect(
      await screen.findByText('Servicio temporalmente no disponible.')
    ).toBeInTheDocument();
    expect(screen.getByText('Primera descripción')).toBeInTheDocument();
  });
});
