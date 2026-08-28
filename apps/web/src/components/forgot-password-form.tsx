"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Field } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmPasswordReset, requestPasswordReset } from "@/features/auth/api";
import { apiErrorMessage, isAbortError, ApiError } from "@/lib/api-client";
import type { Dictionary, Locale } from "@/lib/i18n";

type FlowState = "request" | "requesting" | "requested" | "reset" | "resetting" | "success" | "error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const { auth } = dictionary;
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<FlowState>("request");
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const requestController = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const hash = window.location.hash;
    const value = hash.startsWith("#") ? new URLSearchParams(hash.slice(1)).get("token") : null;
    if (hash) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    const tokenTimer = value ? window.setTimeout(() => {
      setToken(value);
      setState("reset");
    }, 0) : undefined;
    return () => {
      if (tokenTimer) window.clearTimeout(tokenTimer);
      requestController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state]);

  function beginRequest() {
    requestController.current?.abort();
    requestController.current = new AbortController();
    return requestController.current.signal;
  }

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setState("error");
      setMessage(auth.invalidEmail);
      return;
    }
    if (cooldown > 0 || state === "requesting") return;
    setState("requesting");
    setMessage(null);
    try {
      await requestPasswordReset(normalizedEmail, beginRequest());
      setEmail(normalizedEmail);
      setState("requested");
      setCooldown(60);
      setMessage(auth.passwordResetRequested);
    } catch (error) {
      if (isAbortError(error)) return;
      const rateLimited = error instanceof ApiError && error.status === 429;
      if (rateLimited) setCooldown(60);
      setState("error");
      setMessage(rateLimited ? auth.passwordResetRateLimited : apiErrorMessage(error, auth.passwordResetRetry));
    }
  }

  async function submitReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || state === "resetting") return;
    if (newPassword.length < 8) {
      setState("error");
      setMessage(auth.passwordResetPasswordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setState("error");
      setMessage(auth.passwordResetPasswordsDoNotMatch);
      return;
    }
    setState("resetting");
    setMessage(null);
    try {
      await confirmPasswordReset(token, newPassword, beginRequest());
      setToken(null);
      setNewPassword("");
      setConfirmPassword("");
      setState("success");
      setMessage(auth.passwordResetCompleted);
    } catch (error) {
      if (isAbortError(error)) return;
      const rateLimited = error instanceof ApiError && error.status === 429;
      if (rateLimited) setCooldown(60);
      const recoverable = error instanceof ApiError && (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT" || error.status >= 500);
      setState("error");
      setMessage(rateLimited ? auth.passwordResetRateLimited : recoverable ? apiErrorMessage(error, auth.passwordResetRetry) : auth.passwordResetInvalidLink);
    }
  }

  const resetFlow = token !== null;
  const busy = state === "requesting" || state === "resetting";
  const errorId = "password-reset-error";
  const title = resetFlow ? auth.passwordResetNewTitle : auth.passwordResetTitle;
  const description = resetFlow ? auth.passwordResetNewDescription : auth.passwordResetDescription;

  return (
    <AuthFrame
      locale={locale}
      eyebrow={auth.accessEyebrow}
      systemTitle={auth.systemTitle}
      systemDescription={auth.systemDescription}
      title={state === "success" ? auth.passwordResetSuccessTitle : title}
      description={state === "success" ? auth.passwordResetSuccessDescription : description}
      requiredHint={auth.requiredHint}
      centered
      footer={<p className="text-center"><Link href={`/${locale}/login`} className="inline-flex min-h-10 items-center font-semibold text-primary underline-offset-4 hover:underline">{auth.login}</Link></p>}
    >
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">{state === "success" ? auth.passwordResetSuccessTitle : title}</h2>
      {message ? <p id={errorId} role={state === "error" ? "alert" : "status"} aria-live="polite" className={state === "error" ? "mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive" : "mb-4 rounded-md border border-success/30 bg-success/10 p-3 text-body-sm text-success"}>{message}</p> : null}
      {state === "success" ? (
        <Link href={`/${locale}/login`} className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90">{auth.passwordResetGoToLogin}</Link>
      ) : resetFlow ? (
        <form onSubmit={submitReset} className="space-y-4" aria-describedby={message ? errorId : undefined}>
          <Field label={auth.password}><Input id="new-password" name="newPassword" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={auth.passwordPlaceholder} autoComplete="new-password" aria-invalid={state === "error" && newPassword.length < 8} aria-describedby={state === "error" ? errorId : undefined} disabled={busy} /></Field>
          <Field label={auth.confirmPassword}><Input id="confirm-password" name="confirmPassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={auth.confirmPasswordPlaceholder} autoComplete="new-password" aria-invalid={state === "error" && newPassword !== confirmPassword} aria-describedby={state === "error" ? errorId : undefined} disabled={busy} /></Field>
          <Button type="submit" className="w-full" disabled={busy || cooldown > 0}>{state === "resetting" ? auth.passwordResetSaving : cooldown > 0 ? `${auth.passwordResetCooldown} ${cooldown}s` : auth.passwordResetSubmit}</Button>
        </form>
      ) : (
        <form onSubmit={submitRequest} className="space-y-4" aria-describedby={message ? errorId : undefined}>
          <Field label={auth.email}><Input id="reset-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={auth.emailPlaceholder} autoComplete="email" aria-invalid={state === "error" && !EMAIL_PATTERN.test(email.trim())} aria-describedby={state === "error" ? errorId : undefined} disabled={busy} /></Field>
          <Button type="submit" className="w-full" disabled={busy || cooldown > 0}>{state === "requesting" ? auth.passwordResetSending : cooldown > 0 ? `${auth.passwordResetCooldown} ${cooldown}s` : auth.passwordResetSubmitRequest}</Button>
        </form>
      )}
    </AuthFrame>
  );
}
