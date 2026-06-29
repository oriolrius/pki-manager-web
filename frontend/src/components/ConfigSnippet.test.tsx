import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConfigSnippet } from './ConfigSnippet';

describe('ConfigSnippet', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the title and content', () => {
    render(<ConfigSnippet title="My Key" content="ssh-ed25519 AAAA" />);
    expect(screen.getByText('My Key')).toBeInTheDocument();
    expect(screen.getByText('ssh-ed25519 AAAA')).toBeInTheDocument();
  });

  it('copies the content to the clipboard and shows the copied state', async () => {
    const content = 'ssh-ed25519 AAAAC3NzaC1lZ key-content';
    render(<ConfigSnippet title="Public key" content={content} />);

    const copyButton = screen.getByRole('button', { name: /copy to clipboard/i });
    fireEvent.click(copyButton);

    // The exact text was written to the clipboard.
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(content);

    // The transient "copied" check icon appears (svg with class text-green-600).
    await waitFor(() => {
      expect(document.querySelector('.text-green-600')).toBeTruthy();
    });
  });

  it('shows a download button only when a filename is provided', () => {
    const { rerender } = render(<ConfigSnippet content="abc" />);
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();

    rerender(<ConfigSnippet content="abc" downloadFilename="key.pub" />);
    expect(screen.getByRole('button', { name: /download key\.pub/i })).toBeInTheDocument();
  });
});
