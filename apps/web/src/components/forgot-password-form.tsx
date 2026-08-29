"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Field } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmPasswordReset, requestPasswordReset, validatePasswordReset } from "@/features/auth/api";
import { apiErrorMessage, isAbortError, ApiError } from "@/lib/api-client";
import type { Dictionary, Locale } from "@/lib/i18n";

type FlowState = "request" | "requesting" | "requested" | "validating" | "validationError" | "reset" | "resetting" | "success" | "invalid" | "error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const { auth } = dictionary;
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<FlowState>("request");
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const requestController = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const beginRequest = useCallback(() => {
    requestController.current?.abort();
    requestController.current = new AbortController();
    return requestController.current.signal;
  }, []);

  const validateToken = useCallback((candidate: string) => {
    setState("validating");
    setMessage(null);
    const signal = beginRequest();
    void validatePasswordReset(candidate, signal)
      .then(() => {
        setToken(candidate);
        setPendingToken(null);
        setState("reset");
      })
      .catch((error) => {
        if (isAbortError(error)) return;
        if (error instanceof ApiError && error.status === 400) {
          setPendingToken(null);
          setState("invalid");
          setMessage(auth.passwordResetInvalidLink);
          return;
        }
        setState("validationError");
        if (error instanceof ApiError && error.status === 429) {
          setCooldown(60);
          setMessage(auth.passwordResetRateLimited);
          return;
        }
        setMessage(apiErrorMessage(error, auth.passwordResetRetry));
      });
  }, [auth, beginRequest]);

  useEffect(() => {
    const hash = window.location.hash;
    const value = hash.startsWith("#") ? new URLSearchParams(hash.slice(1)).get("token") : null;
    if (hash) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    if (!value) return;
    const tokenTimer = window.setTimeout(() => {
      setPendingToken(value);
      validateToken(value);
    }, 0);
    return () => {
      window.clearTimeout(tokenTimer);
      requestController.current?.abort();
    };
  }, [validateToken]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state]);

  function retryValidation() {
    if (!pendingToken || state === "validating" || cooldown > 0) return;
    validateToken(pendingToken);
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
      if (error instanceof ApiError && error.status === 400) {
        setToken(null);
        setNewPassword("");
        setConfirmPassword("");
        setState("invalid");
        setMessage(auth.passwordResetInvalidLink);
        return;
      }
      setState("error");
      setMessage(rateLimited ? auth.passwordResetRateLimited : apiErrorMessage(error, auth.passwordResetRetry));
    }
  }

  const resetFlow = token !== null;
  const invalidReset = state === "invalid";
  const validatingReset = state === "validating";
  const validationError = state === "validationError";
  const busy = state === "requesting" || state === "resetting";
  const errorId = "password-reset-error";
  const title = resetFlow || invalidReset || validatingReset || validationError ? auth.passwordResetNewTitle : auth.passwordResetTitle;
  const description = resetFlow || invalidReset || validatingReset || validationError ? auth.passwordResetNewDescription : auth.passwordResetDescription;

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
      {message ? <p id={errorId} role={state === "error" || validationError ? "alert" : "status"} aria-live="polite" className={state === "error" || validationError ? "mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive" : "mb-4 rounded-md border border-success/30 bg-success/10 p-3 text-body-sm text-success"}>{message}</p> : null}
      {state === "success" ? (
        <Link href={`/${locale}/login`} className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90">{auth.passwordResetGoToLogin}</Link>
      ) : invalidReset ? null : validatingReset ? (
        <p role="status" aria-live="polite" className="text-center text-body-sm text-muted-foreground">{auth.passwordResetValidating}</p>
      ) : validationError ? (
        <Button type="button" className="w-full" onClick={retryValidation} disabled={cooldown > 0}>{cooldown > 0 ? `${auth.passwordResetCooldown} ${cooldown}s` : auth.passwordResetRetryValidation}</Button>
      ) : resetFlow ? (
        <form onSubmit={submitReset} className="space-y-4" aria-describedby={message ? errorId : undefined}>
          <Field label={auth.password}>
            <div className="relative">
              <Input id="new-password" name="newPassword" type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={auth.passwordPlaceholder} autoComplete="new-password" aria-invalid={state === "error" && newPassword.length < 8} aria-describedby={state === "error" ? errorId : undefined} disabled={busy} className="pr-12" />
              <Button type="button" variant="ghost" size="icon-xs" className="absolute right-1 top-1" aria-label={showNewPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showNewPassword} onClick={() => setShowNewPassword((visible) => !visible)}>
                {showNewPassword ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </Field>
          <Field label={auth.confirmPassword}>
            <div className="relative">
              <Input id="confirm-password" name="confirmPassword" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={auth.confirmPasswordPlaceholder} autoComplete="new-password" aria-invalid={state === "error" && newPassword !== confirmPassword} aria-describedby={state === "error" ? errorId : undefined} disabled={busy} className="pr-12" />
              <Button type="button" variant="ghost" size="icon-xs" className="absolute right-1 top-1" aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)}>
                {showConfirmPassword ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </Field>
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
