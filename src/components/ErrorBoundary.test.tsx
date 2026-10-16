import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en';
import { LocaleProvider } from '../i18n';
import { ErrorBoundary } from './ErrorBoundary';

let broken = true;

function Page() {
  if (broken) throw new Error('boom');
  return <p>page</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('replaces a page that throws with a sentence and a way to start again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.location.hash = '#/?s=broken';
    broken = true;
    render(
      <LocaleProvider initial="en">
        <ErrorBoundary>
          <Page />
        </ErrorBoundary>
      </LocaleProvider>,
    );
    expect(screen.getByText(en['error.crashed'])).toBeInTheDocument();
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: en['error.startAgain'] }));
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
  });
});
