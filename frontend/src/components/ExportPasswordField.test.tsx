import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExportPasswordField } from './ExportPasswordField';
import { generateExportPassword } from '@/lib/export-password';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shows, copies and regenerates a cryptographically generated password', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const secureRandom = vi.spyOn(crypto, 'getRandomValues');
  function Form() {
    const [password, setPassword] = useState(generateExportPassword);
    return <ExportPasswordField value={password} onChange={setPassword} />;
  }
  render(<Form />);
  const field = screen.getByLabelText('Export password') as HTMLInputElement;
  const original = field.value;
  expect(original).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(field.type).toBe('text');
  expect(secureRandom).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(original));
  fireEvent.click(screen.getByRole('button', { name: 'Generate new password' }));
  expect(field.value).not.toBe(original);
  expect(field.value).toMatch(/^[A-Za-z0-9_-]{32}$/);
});

it('keeps a downloaded password readable when clipboard access is unavailable', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  render(<ExportPasswordField value="previous-export-password" />);
  expect(screen.getByLabelText('Export password')).toHaveAttribute('readonly');
  expect(screen.queryByRole('button', { name: 'Generate new password' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('copy it manually'));
  expect(screen.getByLabelText('Export password')).toHaveValue('previous-export-password');
});
