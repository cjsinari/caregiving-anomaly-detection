/*
 * Severity, decisions and statuses as badges.
 *
 * Each badge carries a coloured dot AND its word. That is not belt-and-braces:
 * the four severity colours were measured against each other and the high/medium
 * pair separates by less than the threshold at which ordinary colour vision can
 * reliably tell two fills apart, let alone a reader with a colour-vision
 * deficiency. The word is the channel that works for everyone; the colour is
 * what makes the row scannable once you know the code.
 */

const SEVERITY_CLASS = {
  info: 'badge--info',
  medium: 'badge--medium',
  high: 'badge--high',
  critical: 'badge--critical',
};

const SEVERITY_LABEL = {
  info: 'Info',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export function SeverityBadge({ severity }) {
  const key = String(severity || 'info').toLowerCase();
  return (
    <span className={`badge ${SEVERITY_CLASS[key] || 'badge--neutral'}`}>
      <span className="badge__dot" aria-hidden="true" />
      {SEVERITY_LABEL[key] || severity}
    </span>
  );
}

/** What the service decided about a request for a resource. */
export function DecisionBadge({ decision }) {
  if (!decision) return null;
  const allowed = decision === 'allow';
  return (
    <span className={`badge ${allowed ? 'badge--good' : 'badge--critical'}`}>
      <span className="badge__dot" aria-hidden="true" />
      {allowed ? 'Allowed' : 'Denied'}
    </span>
  );
}

/**
 * What the risk engine did with a sign-in.
 *
 * 'allow' is deliberately the quiet one: it is the overwhelming majority of
 * rows, and a list where every row is coloured is a list with no signal in it.
 */
const ACTION_STYLE = {
  allow: { cls: 'badge--good', label: 'Allowed' },
  step_up: { cls: 'badge--medium', label: 'Step-up' },
  block: { cls: 'badge--critical', label: 'Blocked' },
};

export function ActionBadge({ action }) {
  const style = ACTION_STYLE[action];
  if (!style) return <span className="badge badge--neutral">{action || 'Unknown'}</span>;
  return (
    <span className={`badge ${style.cls}`}>
      <span className="badge__dot" aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** An account's standing. Anything other than active is worth noticing. */
const ACCOUNT_STYLE = {
  active: { cls: 'badge--good', label: 'Active' },
  pending: { cls: 'badge--neutral', label: 'Pending' },
  suspended: { cls: 'badge--high', label: 'Suspended' },
  frozen: { cls: 'badge--critical', label: 'Frozen' },
};

export function AccountStatusBadge({ status }) {
  const style = ACCOUNT_STYLE[status];
  if (!style) return <span className="badge badge--neutral">{status || 'Unknown'}</span>;
  return (
    <span className={`badge ${style.cls}`}>
      <span className="badge__dot" aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** A session's state. 'flagged' means a detector ended it. */
const SESSION_STYLE = {
  active: { cls: 'badge--good', label: 'Active' },
  flagged: { cls: 'badge--critical', label: 'Flagged' },
  invalidated: { cls: 'badge--neutral', label: 'Signed out' },
  expired: { cls: 'badge--neutral', label: 'Expired' },
};

export function SessionStatusBadge({ status }) {
  const style = SESSION_STYLE[status];
  if (!style) return <span className="badge badge--neutral">{status || 'Unknown'}</span>;
  return (
    <span className={`badge ${style.cls}`}>
      <span className="badge__dot" aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** Who acted: a person, an administrator, or the system on its own. */
const ACTOR_LABEL = {
  user: 'Account holder',
  administrator: 'Administrator',
  automated: 'Automated',
  system: 'System',
};

export function ActorBadge({ actorType }) {
  if (!actorType) return null;
  return (
    <span className="badge badge--neutral">{ACTOR_LABEL[actorType] || actorType}</span>
  );
}

export function RoleBadge({ role }) {
  if (!role) return null;
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  return <span className="badge badge--neutral">{label}</span>;
}
