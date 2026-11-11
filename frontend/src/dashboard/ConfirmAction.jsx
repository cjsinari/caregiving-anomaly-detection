import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import './confirm.css';

/*
 * The dialog in front of an action that affects someone's access.
 *
 * ── Why a reason is a field and not a checkbox ──
 *
 * The service requires a reason of at least five characters on every
 * administrator action and stores it with the action. That is not form
 * ceremony: these are the decisions most likely to be questioned afterwards —
 * by the person who was locked out, or by whoever is checking that the people
 * with the power to lock accounts are using it properly — and an action with no
 * stated reason is unreviewable. The field is here because the API would refuse
 * without it, and the dialog makes that requirement visible rather than letting
 * it arrive as a 400.
 *
 * ── What the dialog says ──
 *
 * The consequence, in the words that matter to the person affected: how many
 * sessions end, whether it expires on its own, whether the owner is told. An
 * administrator at 2am should not have to remember the difference between a
 * lock and a freeze — the dialog states it.
 *
 * ── Keyboard ──
 *
 * Focus moves to the first field, Escape cancels, and focus is restored to
 * whatever opened it. A confirmation dialog that cannot be dismissed by
 * keyboard is worse than none: it stops the work and offers no way out.
 */
export default function ConfirmAction({
  title,
  verb,
  consequence,
  onConfirm,
  onClose,
  destructive = true,
  requireReason = true,
  extraFields = null,
  reasonHint = 'Stored with the action and shown in the audit log. At least five characters.',
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const field = useRef(null);
  const opener = useRef(null);

  useEffect(() => {
    opener.current = document.activeElement;
    field.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Returning focus matters most for the keyboard case: without it, focus
      // falls back to the document and the next Tab starts from the top of the
      // page rather than from the row that was being worked on.
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose, busy]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason: reason.trim() });
      onClose();
    } catch (err) {
      // The dialog stays open on failure, holding the typed reason: the action
      // did not happen, and making it retypeable is the least an administrator
      // is owed when a 409 says the account was already frozen.
      setError(err instanceof ApiError ? err : new ApiError('The action could not be completed.'));
      setBusy(false);
    }
  };

  const tooShort = requireReason && reason.trim().length < 5;

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onSubmit={submit}
      >
        <h2 className="confirm__title" id="confirm-title">{title}</h2>

        {/* Stated, not implied. The difference between a lock and a freeze is
            the whole reason both exist. */}
        <p className="confirm__consequence">{consequence}</p>

        {extraFields}

        {requireReason && (
          <label className="field">
            <span className="field__label">Reason</span>
            <textarea
              ref={field}
              className="input confirm__reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What prompted this, and what you have already checked."
              disabled={busy}
              required
              minLength={5}
              maxLength={255}
            />
            <span className="field__hint">{reasonHint}</span>
          </label>
        )}

        {error && (
          <p className="confirm__error" role="alert">
            {error.message}
            {error.details?.length ? ` (${error.details.map((d) => d.message).join('; ')})` : ''}
          </p>
        )}

        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn ${destructive ? 'btn--danger' : 'btn--primary'}`}
            disabled={busy || tooShort}
          >
            {busy ? 'Working…' : verb}
          </button>
        </div>
      </form>
    </div>
  );
}
