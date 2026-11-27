import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppFooter } from './AppFooter';

describe('AppFooter', () => {
  it('shows the version and links to the GitHub project and the website in a new tab', () => {
    render(<AppFooter version="4.0.0" />);

    expect(screen.getByText('PKI Manager v4.0.0')).toBeInTheDocument();

    const github = screen.getByRole('link', { name: 'Source code on GitHub' });
    expect(github).toHaveAttribute('href', 'https://github.com/oriolrius/pki-manager-web');
    const site = screen.getByRole('link', { name: 'Project website and documentation' });
    expect(site).toHaveAttribute('href', 'https://pki-manager.oriolrius.cat');

    for (const link of [github, site]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
