/*
 * A view that has its route, its heading and its place in the layout, but not
 * yet its contents.
 *
 * Deliberately explicit about what is missing rather than showing an empty
 * panel: an empty panel is indistinguishable from a panel whose request
 * returned nothing, which is the one confusion a security console cannot
 * afford. Replaced as each view is built.
 */
export default function Placeholder({ title, children }) {
  return (
    <div className="card">
      <div className="card__header">
        <div>
          <h2 className="card__title">{title}</h2>
          <p className="card__subtitle">Not built yet — this route renders inside the console layout.</p>
        </div>
      </div>
      <div className="card__body">
        <p className="secondary" style={{ fontSize: 'var(--text-sm)', maxWidth: '44rem' }}>{children}</p>
      </div>
    </div>
  );
}
