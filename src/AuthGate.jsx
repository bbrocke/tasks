import React, { useEffect, useRef, useState } from "react";
import { supabase, supabaseConfigError } from "./supabase";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const busyRef = useRef(false);

  const rememberList = () => {
    try {
      if (window.location.hash.startsWith("#/")) sessionStorage.setItem("tasks.returnTo", window.location.hash);
    } catch { /* Sign-in still works when storage is unavailable. */ }
  };

  useEffect(() => {
    if (!supabase || supabaseConfigError) {
      setError("Sign-in is unavailable. Please contact the app owner.");
      setChecking(false);
      return;
    }
    let active = true;
    let receivedAuthEvent = false;
    const callbackUrl = new URL(window.location.href);
    if (callbackUrl.searchParams.has("error")) {
      setError("That sign-in link couldn't be used. Request a new link and open it in this browser.");
      for (const key of ["error", "error_code", "error_description"]) callbackUrl.searchParams.delete(key);
      window.history.replaceState(null, "", `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
    }
    const acceptSession = (next) => {
      const signedIn = next?.user && !next.user.is_anonymous ? next : null;
      if (signedIn) {
        setError(null);
        try {
          const hash = sessionStorage.getItem("tasks.returnTo");
          sessionStorage.removeItem("tasks.returnTo");
          if (hash?.startsWith("#/") && !window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
        } catch { /* No saved route is required to sign in. */ }
      }
      setSession(signedIn);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      receivedAuthEvent = true;
      acceptSession(next);
      setChecking(false);
    });
    // Subscribe before reading storage so a stale read cannot undo a sign-out.
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || receivedAuthEvent) return;
      if (sessionError) setError("Couldn't check your sign-in. Reload and try again.");
      else acceptSession(data.session);
      setChecking(false);
    }).catch(() => {
      if (!active || receivedAuthEvent) return;
      setError("Couldn't check your sign-in. Reload and try again.");
      setChecking(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const sendLink = async (event) => {
    event.preventDefault();
    if (!supabase || busyRef.current || !email.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      rememberList();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      });
      if (authError) throw authError;
      setSent(true);
    } catch {
      setError("Couldn't send a sign-in link. Check your email address and try again in a minute.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      setSession(null);
      setSent(false);
      setEmail("");
    } catch {
      setError("Couldn't sign out. Check your connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (checking) return <main className="auth-page"><p role="status">Checking your sign-in…</p></main>;
  if (session?.user) {
    return <>
      <header className="account-bar">
        <span>Signed in as {session.user.email}</span>
        <button onClick={signOut} disabled={busy}>Sign out</button>
        {error && <p role="alert">{error}</p>}
      </header>
      {/* A different user or a sign-out destroys all loaded tasks and drafts. */}
      <React.Fragment key={session.user.id}>{children(session.user)}</React.Fragment>
    </>;
  }
  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="sign-in-heading">
      <p className="auth-eyebrow">YOUR EVERYDAY NOTEBOOK</p>
      <h1 id="sign-in-heading">Your lists, your space.</h1>
      <p>Sign in with a link sent to your email. No password to remember.</p>
      <form onSubmit={sendLink} aria-busy={busy}>
        <label htmlFor="sign-in-email">Email address</label>
        <input id="sign-in-email" type="email" autoComplete="email" required value={email}
          onChange={(event) => setEmail(event.target.value)} disabled={busy || !supabase} />
        <button type="submit" disabled={busy || !supabase}>{busy ? "Sending…" : "Send sign-in link"}</button>
      </form>
      {sent && <p role="status">Check your inbox. Open the sign-in link in this browser to continue. If it has expired, request a new link.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
