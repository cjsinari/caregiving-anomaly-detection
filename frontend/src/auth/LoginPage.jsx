import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { STEP, useAuth } from './AuthContext';
import './login.css';

/*
 * Signing in to the console.
 *
 * Three steps, because the service has three: the number, the code, and — when
 * the risk engine is not satisfied — a second code. The third is not an error
 * state and is not presented as one. An administrator signing in from a new
 * machine will meet it routinely, and a screen that looked like a failure would
 * teach them to distrust the thing that is protecting them.
 *
 * What this screen deliberately does not do is tell anyone whether a number is
 * registered. The service answers the first step identically either way, and
 * the copy here matches that: "if that number belongs to an account". A console
 * that said "no such administrator" would hand over a list of which numbers are
 * worth attacking.
 */
export default function LoginPage() {
  const { isAuthenticated, step, pending, error, notice, phoneNumber,
          requestCode, submitCode, submitStepUp, restart } = useAuth();
  const location = useLocation();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const codeField = useRef(null);

  // Move focus to the code field when it appears, so the administrator can type
  // the code straight from the phone without reaching for the mouse.
  useEffect(() => {
    if (step === STEP.CODE || step === STEP.STEP_UP) {
      setCode('');
      codeField.current?.focus();
    }
  }, [step]);

  if (isAuthenticated) {
    return <Navigate to={location.state?.from || '/'} replace />;
  }

  const onSubmit = (event) => {
    event.preventDefault();
    if (pending) return;
    if (step === STEP.PHONE) return requestCode(phone.trim());
    if (step === STEP.CODE) return submitCode(code.trim());
    return submitStepUp(code.trim());
  };

  const askingForCode = step === STEP.CODE || step === STEP.STEP_UP;

  return (
    <main className="login">
      <div className="login__panel">
        <header className="login__head">
          <div className="login__mark" aria-hidden="true">MC</div>
          <div>
            <h1 className="login__title">MzaziCare</h1>
            <p className="login__subtitle">Security console</p>
          </div>
        </header>

        <form className="login__form" onSubmit={onSubmit} noValidate>
          {step === STEP.STEP_UP && (
            <div className="login__step-up">
              <strong>Extra verification</strong>
              <p className="small secondary">
                This sign-in needs a second code before the session starts. This device will be
                remembered afterwards, so you will not be asked again from here.
              </p>
            </div>
          )}

          {!askingForCode ? (
            <div className="field">
              <label className="field__label" htmlFor="phone">Phone number</label>
              <input
                id="phone"
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                placeholder="0712 345 678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={pending}
                required
              />
              <span className="field__hint">
                The number on your administrator account. Kenyan local or +254 format.
              </span>
            </div>
          ) : (
            <div className="field">
              <label className="field__label" htmlFor="code">Six-digit code</label>
              <input
                id="code"
                ref={codeField}
                className="input input--otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="------"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                disabled={pending}
                required
              />
              <span className="field__hint">
                Sent to {maskForDisplay(phoneNumber)}. It expires in five minutes.
              </span>
            </div>
          )}

          {/* Announced to a screen reader when it appears, not merely coloured. */}
          {error && <p className="login__error" role="alert">{error}</p>}
          {notice && !error && <p className="login__notice" role="status">{notice}</p>}

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={pending || (askingForCode ? code.length !== 6 : phone.trim().length < 9)}
          >
            {pending ? 'Working…'
              : askingForCode ? 'Verify and sign in'
              : 'Send code'}
          </button>

          {askingForCode && (
            <button type="button" className="btn btn--ghost btn--sm btn--block" onClick={restart} disabled={pending}>
              Use a different number
            </button>
          )}
        </form>

        <footer className="login__foot small muted">
          Sign-ins to this console are scored and recorded like any other. Access is limited to
          administrator accounts.
        </footer>
      </div>
    </main>
  );
}

/**
 * Show enough of the number to confirm the right one was typed, and no more.
 * The console runs on shared screens; a fully rendered number on the login step
 * is a phone number on display for as long as the code takes to arrive.
 */
function maskForDisplay(value) {
  if (!value) return 'your phone';
  const digits = String(value).replace(/\s/g, '');
  if (digits.length < 6) return 'your phone';
  return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
}
