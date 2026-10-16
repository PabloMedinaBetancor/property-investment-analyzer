import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLang } from './model/storage';
import { Root } from './Root';
import { fakeEngine } from './test-engine';

vi.mock('./engine/client', async (original) => ({
  ...(await original<typeof import('./engine/client')>()),
  startEngine: () => fakeEngine(),
}));

afterEach(() => {
  window.localStorage.clear();
});

describe('Root', () => {
  it('opens in the saved language', () => {
    window.localStorage.setItem('pia.lang', 'es');
    render(<Root />);
    expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves the language when it is changed', async () => {
    window.localStorage.setItem('pia.lang', 'en');
    render(<Root />);
    await userEvent.click(screen.getByRole('button', { name: 'Español' }));
    expect(getLang()).toBe('es');
  });
});
