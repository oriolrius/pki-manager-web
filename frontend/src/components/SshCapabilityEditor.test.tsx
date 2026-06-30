import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import {
  SshCapabilityEditor,
  defaultCapabilityValue,
  ALL_SSH_EXTENSIONS,
  type SshCapabilityValue,
} from './SshCapabilityEditor';

/** Controlled wrapper so onChange updates re-render the editor. */
function Harness({ initial }: { initial?: SshCapabilityValue }) {
  const [value, setValue] = useState<SshCapabilityValue>(initial ?? defaultCapabilityValue());
  return <SshCapabilityEditor value={value} onChange={setValue} />;
}

describe('SshCapabilityEditor', () => {
  it('defaults to all five extensions enabled', () => {
    const onChange = vi.fn();
    render(<SshCapabilityEditor value={defaultCapabilityValue()} onChange={onChange} />);
    for (const ext of ALL_SSH_EXTENSIONS) {
      const checkbox = screen.getByRole('checkbox', { name: ext }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    }
  });

  it('Harden preset clears all extensions', () => {
    const onChange = vi.fn();
    render(<SshCapabilityEditor value={defaultCapabilityValue()} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /harden/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as SshCapabilityValue;
    expect(next.extensions).toEqual([]);
  });

  it('Harden updates the live summary to "none (hardened)" when controlled', () => {
    render(<Harness />);

    // Initially the summary lists all five extensions joined together.
    expect(
      screen.getByText(ALL_SSH_EXTENSIONS.join(', '))
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /harden/i }));

    expect(screen.getByText(/none \(hardened\)/i)).toBeInTheDocument();
  });
});
