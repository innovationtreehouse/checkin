"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave this page without saving?';

type GuardState = { dirty: boolean; message: string };

type UnsavedChangesContextValue = {
  /** Update the current dirty flag + message; called by useUnsavedGuard. */
  setGuard: (dirty: boolean, message: string) => void;
  /** True if navigation may proceed: not dirty, or the user confirmed leaving. */
  confirmNav: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

/**
 * App-wide guard against leaving a page with unsaved form edits. A single
 * provider holds the current dirty state in a ref; pages register their dirty
 * flag via useUnsavedGuard, and the shared nav chokepoints (sidebar, section
 * tab bars) gate navigation through confirmNav().
 *
 * Two escape routes are covered: the browser (close/refresh/back) via a global
 * beforeunload listener, and in-app router navigation via confirmNav().
 */
export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  // Dirty state lives in a ref, not React state: it flips on every keystroke and
  // this provider wraps the whole app tree, so state here would re-render
  // everything per keystroke.
  const state = useRef<GuardState>({ dirty: false, message: DEFAULT_MESSAGE });

  const setGuard = useCallback((dirty: boolean, message: string) => {
    state.current = { dirty, message };
  }, []);

  const confirmNav = useCallback(() => {
    if (!state.current.dirty) return true;
    return window.confirm(state.current.message);
  }, []);

  // ponytail: one always-on beforeunload listener guarded by the ref, instead of
  // add/remove churn on every dirty toggle. Functionally identical — the browser
  // only prompts when the handler calls preventDefault.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!state.current.dirty) return;
      e.preventDefault();
      e.returnValue = ''; // legacy browsers require a string assignment to prompt
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return (
    <UnsavedChangesContext.Provider value={{ setGuard, confirmNav }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

/**
 * Register a page's dirty state with the guard. Pass an isDirty boolean (and an
 * optional custom message); the guard clears automatically on unmount.
 */
export function useUnsavedGuard(isDirty: boolean, message: string = DEFAULT_MESSAGE) {
  const ctx = useContext(UnsavedChangesContext);
  useEffect(() => {
    ctx?.setGuard(isDirty, message);
    return () => ctx?.setGuard(false, DEFAULT_MESSAGE);
  }, [ctx, isDirty, message]);
}

/**
 * Returns confirmNav() for the shared nav chokepoints. When no provider is
 * mounted (tests, kiosk) it returns a no-op that always allows navigation.
 */
export function useConfirmNav(): () => boolean {
  const ctx = useContext(UnsavedChangesContext);
  return ctx?.confirmNav ?? (() => true);
}

/**
 * Shallow-equal over plain records of primitives. Used by pages to derive an
 * isDirty boolean by comparing a snapshot of loaded values to current state —
 * no deps, no deep structures (form fields are strings/booleans/numbers).
 */
export function shallowEqual(
  a: Record<string, string | number | boolean | null>,
  b: Record<string, string | number | boolean | null>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}
