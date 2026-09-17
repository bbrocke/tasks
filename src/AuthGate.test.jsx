// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuthGate from './AuthGate';
import App from './App';
import { supabase } from './supabase';

vi.mock('./supabase', () => ({
  supabaseConfigError: null,
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithOtp: vi.fn(), signOut: vi.fn() },
  },
}));

const alice = { user: { id: 'alice', email: 'alice@example.test', is_anonymous: false } };
const bob = { user: { id: 'bob', email: 'bob@example.test', is_anonymous: false } };
let authChanged;
let unsubscribe;

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.from.mockReset();
  window.history.replaceState(null, '', '/#/work');
  sessionStorage.clear();
  unsubscribe = vi.fn();
  supabase.auth.onAuthStateChange.mockImplementation((callback) => {
    authChanged = callback;
    return { data: { subscription: { unsubscribe } } };
  });
  supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
  supabase.auth.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

it('never queries task data while checking the session or signed out', async () => {
  const initial = deferred();
  supabase.auth.getSession.mockReturnValue(initial.promise);
  render(<App />);
  expect(screen.getByRole('status').textContent).toContain('Checking');
  expect(supabase.from).not.toHaveBeenCalled();
  await act(async () => initial.resolve({ data: { session: null }, error: null }));
  expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeTruthy();
  expect(supabase.from).not.toHaveBeenCalled();
});

it('requests an email link once, without passwords, and remembers the saved list', async () => {
  const pending = deferred();
  supabase.auth.signInWithOtp.mockReturnValue(pending.promise);
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  const input = await screen.findByLabelText('Email address');
  fireEvent.change(input, { target: { value: 'alice@example.test' } });
  act(() => { fireEvent.submit(input.form); fireEvent.submit(input.form); });
  expect(supabase.auth.signInWithOtp).toHaveBeenCalledTimes(1);
  expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
    email: 'alice@example.test',
    options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/` },
  });
  expect(sessionStorage.getItem('tasks.returnTo')).toBe('#/work');
  await act(async () => pending.resolve({ error: null }));
  expect(screen.getByRole('status').textContent).toContain('Check your inbox');
  expect(screen.queryByText('Private lists')).toBeNull();
});

it('keeps email available for retry after a failed link request', async () => {
  supabase.auth.signInWithOtp.mockResolvedValue({ error: new Error('Rate limit') });
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  const input = await screen.findByLabelText('Email address');
  fireEvent.change(input, { target: { value: 'alice@example.test' } });
  fireEvent.submit(input.form);
  await screen.findByRole('alert');
  expect(input.value).toBe('alice@example.test');
  expect(input.disabled).toBe(false);
});

it.each([
  ['over_email_send_rate_limit', 'reached its sending limit'],
  ['over_request_rate_limit', 'Wait at least a minute'],
  ['email_address_not_authorized', 'not configured to send to this address'],
  ['email_provider_disabled', 'Email sign-in is currently disabled'],
])('explains the actual email failure (%s) without showing untrusted server text', async (code, expected) => {
  supabase.auth.signInWithOtp.mockResolvedValue({ error: { code, message: 'Untrusted internal details' } });
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  const input = await screen.findByLabelText('Email address');
  fireEvent.change(input, { target: { value: 'alice@example.test' } });
  fireEvent.submit(input.form);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(expected);
  expect(alert.textContent).not.toContain('Untrusted internal details');
  expect(screen.queryByText('Private lists')).toBeNull();
});

it('opens the planner only after sign-in and restores the remembered list', async () => {
  render(<AuthGate>{(user) => <p>Private lists for {user.id}</p>}</AuthGate>);
  await screen.findByLabelText('Email address');
  sessionStorage.setItem('tasks.returnTo', '#/work');
  window.history.replaceState(null, '', '/');
  act(() => authChanged('SIGNED_IN', alice));
  expect(screen.getByText('Private lists for alice')).toBeTruthy();
  expect(window.location.hash).toBe('#/work');
  expect(sessionStorage.getItem('tasks.returnTo')).toBeNull();
});

it('clears private component state when switching accounts or signing out', async () => {
  function Draft() {
    const [draft, setDraft] = useState('');
    return <input aria-label="Private draft" value={draft} onChange={(event) => setDraft(event.target.value)} />;
  }
  supabase.auth.getSession.mockResolvedValue({ data: { session: alice }, error: null });
  render(<AuthGate>{() => <Draft />}</AuthGate>);
  const draft = await screen.findByLabelText('Private draft');
  fireEvent.change(draft, { target: { value: 'Alice secret' } });
  act(() => authChanged('SIGNED_IN', bob));
  expect(screen.getByLabelText('Private draft').value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Email address');
  expect(screen.queryByLabelText('Private draft')).toBeNull();
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});

it('does not let a stale session read restore a signed-out account', async () => {
  const initial = deferred();
  supabase.auth.getSession.mockReturnValue(initial.promise);
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  act(() => authChanged('SIGNED_OUT', null));
  await act(async () => initial.resolve({ data: { session: alice }, error: null }));
  expect(screen.queryByText('Private lists')).toBeNull();
  expect(screen.getByLabelText('Email address')).toBeTruthy();
});

it('unmounts private data on session expiry', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: alice }, error: null });
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  await screen.findByText('Private lists');
  act(() => authChanged('SIGNED_OUT', null));
  expect(screen.queryByText('Private lists')).toBeNull();
});

it('does not treat an anonymous Auth session as a private account', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { ...alice.user, is_anonymous: true } } }, error: null });
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  await screen.findByLabelText('Email address');
  expect(screen.queryByText('Private lists')).toBeNull();
});

it('reports failed sign-out instead of claiming the session ended', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: alice }, error: null });
  supabase.auth.signOut.mockResolvedValue({ error: new Error('Offline') });
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Private lists')).toBeTruthy();
});

it('cleans up the auth subscription on unmount', () => {
  const view = render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('shows a useful message for expired email callbacks without reflecting URL text', async () => {
  window.history.replaceState(null, '', '/?error=access_denied&error_description=untrusted');
  render(<AuthGate>{() => <p>Private lists</p>}</AuthGate>);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Request a new link');
  expect(alert.textContent).not.toContain('untrusted');
  expect(window.location.search).toBe('');
});

it('filters reads by the signed-in user and ignores old account responses after sign-out', async () => {
  const oldLists = deferred();
  const oldTasks = deferred();
  const filters = [];
  supabase.from.mockImplementation((table) => ({
    select: () => ({ eq: (column, value) => {
      filters.push([table, column, value]);
      return { order: () => value === 'alice'
        ? (table === 'lists' ? oldLists.promise : oldTasks.promise)
        : Promise.resolve({ data: [] }) };
    } }),
  }));
  supabase.auth.getSession.mockResolvedValue({ data: { session: alice }, error: null });
  render(<App />);
  await screen.findByText('Loading your spread…');
  expect(filters).toEqual([['lists', 'owner_id', 'alice'], ['tasks', 'lists.owner_id', 'alice']]);
  act(() => authChanged('SIGNED_OUT', null));
  act(() => authChanged('SIGNED_IN', bob));
  await screen.findByText('Your account is signed in, but no lists are linked to it yet.');
  await act(async () => {
    oldLists.resolve({ data: [{ id: 'work', name: 'Alice private list', color: '#000', tape: '#fff' }] });
    oldTasks.resolve({ data: [] });
  });
  expect(screen.queryByText('Alice private list')).toBeNull();
  expect(filters.slice(-2)).toEqual([['lists', 'owner_id', 'bob'], ['tasks', 'lists.owner_id', 'bob']]);
});
