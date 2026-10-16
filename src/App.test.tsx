import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Inputs } from './engine/types';
import { LocaleProvider } from './i18n';
import { examples } from './model/examples';
import { decode, encode } from './model/urlState';
import { fakeEngine } from './test-engine';

vi.mock('./engine/client', async (original) => ({
  ...(await original<typeof import('./engine/client')>()),
  startEngine: () => fakeEngine(),
}));

describe('App', () => {
  it('shows the analyze page and marks it as the current link', () => {
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Analyze' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Analyze' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers a first Tab stop that moves the focus to the results without changing the address', async () => {
    window.location.hash = '#/';
    const user = userEvent.setup();
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to results' });
    expect(skip).toHaveFocus();
    const address = window.location.hash;
    await user.keyboard('{Enter}');
    expect(screen.getByRole('region', { name: 'Results' })).toHaveFocus();
    expect(window.location.hash).toBe(address);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('region', { name: 'Property and assumptions' })).toHaveFocus();
  });

  it('switching to Español renames the heading and the document language', async () => {
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Español' }));
    expect(screen.getByRole('heading', { name: 'Analizar' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es');
  });

  it('the Analyze link after a visit to Compare returns to the scenario that was being edited', async () => {
    const edited = { ...(examples[0]?.inputs as Inputs), price: 250000 };
    window.location.hash = `#/?s=${encode(edited)}`;
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    const nav = within(screen.getByRole('navigation'));
    await userEvent.click(nav.getByRole('link', { name: 'Compare' }));
    expect(window.location.hash).toBe('#/compare');
    await userEvent.click(nav.getByRole('link', { name: 'Analyze' }));
    const back = decode(window.location.hash.split('?s=')[1] ?? '');
    expect('inputs' in back && back.inputs.price).toBe(250000);
  });

  it('the Analyze link also remembers the scenario after leaving through the toolbar Compare link', async () => {
    const edited = { ...(examples[0]?.inputs as Inputs), price: 275000 };
    window.location.hash = `#/?s=${encode(edited)}`;
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: /compare/i }));
    await waitFor(() => {
      expect(window.location.hash).toContain('#/compare');
    });
    await userEvent.click(
      within(screen.getByRole('navigation')).getByRole('link', { name: 'Analyze' }),
    );
    const back = decode(window.location.hash.split('?s=')[1] ?? '');
    expect('inputs' in back && back.inputs.price).toBe(275000);
  });

  it('the Analyze link remembers the scenario after the browser back button leaves Analyze', async () => {
    const edited = { ...(examples[0]?.inputs as Inputs), price: 290000 };
    window.location.hash = '#/compare';
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    window.location.hash = `#/?s=${encode(edited)}`;
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Analyze' })).toBeInTheDocument();
    });
    window.history.back();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/compare');
    });
    await userEvent.click(
      within(screen.getByRole('navigation')).getByRole('link', { name: 'Analyze' }),
    );
    const back = decode(window.location.hash.split('?s=')[1] ?? '');
    expect('inputs' in back && back.inputs.price).toBe(290000);
  });
});
