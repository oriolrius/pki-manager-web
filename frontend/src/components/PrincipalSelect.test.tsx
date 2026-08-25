import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { PrincipalSelect, type PrincipalOption } from './PrincipalSelect';

const CATALOG: PrincipalOption[] = [
  { name: 'admins', description: 'Production administrators' },
  { name: 'deployers' },
  { name: 'auditors' },
];

/** Controlled wrapper so selections re-render the component. */
function Harness({ initial = [] as string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return <PrincipalSelect label="Principals" options={CATALOG} value={value} onChange={setValue} />;
}

const combobox = () => screen.getByRole('combobox');

describe('PrincipalSelect', () => {
  it('offers the catalog principals on focus', () => {
    render(<Harness />);
    fireEvent.focus(combobox());
    for (const p of CATALOG) {
      expect(screen.getByRole('option', { name: new RegExp(p.name) })).toBeInTheDocument();
    }
  });

  it('filters the options as the user types', () => {
    render(<Harness />);
    fireEvent.change(combobox(), { target: { value: 'depl' } });

    expect(screen.getByRole('option', { name: /deployers/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /admins/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /auditors/ })).not.toBeInTheDocument();
  });

  it('selects several principals and removes one', () => {
    render(<Harness />);

    fireEvent.focus(combobox());
    fireEvent.click(screen.getByRole('option', { name: /admins/ }));
    fireEvent.focus(combobox());
    fireEvent.click(screen.getByRole('option', { name: /auditors/ }));

    expect(screen.getByRole('button', { name: 'Remove admins' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove auditors' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove admins' }));

    expect(screen.queryByRole('button', { name: 'Remove admins' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove auditors' })).toBeInTheDocument();
  });

  it('does not offer an already-selected principal again', () => {
    render(<Harness initial={['admins']} />);
    fireEvent.focus(combobox());
    expect(screen.queryByRole('option', { name: /admins/ })).not.toBeInTheDocument();
  });

  it('Enter takes the single filtered match rather than the raw text', () => {
    const onChange = vi.fn();
    render(<PrincipalSelect options={CATALOG} value={[]} onChange={onChange} />);

    fireEvent.change(combobox(), { target: { value: 'audit' } });
    fireEvent.keyDown(combobox(), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['auditors']);
  });

  it('allows a principal that is not in the catalog and marks it', () => {
    render(<Harness />);

    fireEvent.change(combobox(), { target: { value: 'sre-oncall' } });
    fireEvent.click(screen.getByRole('button', { name: /not in the catalog/i }));

    expect(screen.getByRole('button', { name: 'Remove sre-oncall' })).toBeInTheDocument();
    expect(screen.getByLabelText('Not in catalog')).toBeInTheDocument();
  });

  it('marks only off-catalog selections', () => {
    render(<Harness initial={['admins']} />);
    expect(screen.queryByLabelText('Not in catalog')).not.toBeInTheDocument();
  });
});
