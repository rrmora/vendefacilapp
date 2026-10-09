// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ProductNotesField } from '@/components/description/ProductNotesField';

function ProductNotesHarness() {
  const [value, setValue] = useState('');

  return <ProductNotesField id="userNotes" value={value} onChange={setValue} />;
}

describe('ProductNotesField', () => {
  it('muestra el contador de caracteres actualizado', async () => {
    const user = userEvent.setup();
    render(<ProductNotesHarness />);

    const textarea = screen.getByLabelText(/Qué estás vendiendo/);
    await user.type(textarea, 'hola');

    expect(screen.getByText('4/500')).toBeInTheDocument();
  });

  it(
    'limita la entrada a 500 caracteres',
    async () => {
      const user = userEvent.setup();
      render(<ProductNotesHarness />);

      const textarea = screen.getByLabelText(/Qué estás vendiendo/);
      await user.type(textarea, 'a'.repeat(520));

      expect(textarea).toHaveValue('a'.repeat(500));
      expect(screen.getByText('500/500')).toBeInTheDocument();
    },
    30000
  );

  it('muestra el error cuando se proporciona', () => {
    render(
      <ProductNotesField
        id="userNotes"
        value="ab"
        error="Describe qué estás vendiendo (entre 3 y 500 caracteres)."
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Describe qué estás vendiendo/
    );
    expect(screen.getByLabelText(/Qué estás vendiendo/)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });
});
