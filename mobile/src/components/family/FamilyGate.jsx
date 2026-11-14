import { ListEmpty, ListError, ListSkeleton } from '../oneui/ListState';
import { useFamily } from '../../family/FamilyContext';

/*
 * Every family screen is about one loved one, so every family screen first
 * needs to know there is one.
 *
 * Three states before that, handled here once rather than five times:
 *
 *   loading  the list of linked loved ones has not arrived
 *   error    it could not be loaded, with a retry
 *   empty    the account is linked to nobody yet
 *
 * The empty state matters more than it looks. A family account with no care
 * profile is the normal state of a brand-new account, and five screens of
 * blank cards would read as the app being broken on the first day anybody
 * uses it. It says what has to happen instead.
 *
 * Children are a function of the selected loved one, so a screen never
 * renders against a missing one.
 */
export default function FamilyGate({ children, skeletonRows = 3, skeletonHeight = 110 }) {
  const { status, error, reload, selected } = useFamily();

  if (status === 'loading' || status === 'idle') {
    return <ListSkeleton rows={skeletonRows} height={skeletonHeight} />;
  }
  if (!selected && status === 'error') {
    return <ListError error={error} onRetry={reload} title="Could not load your family" />;
  }
  if (!selected) {
    return (
      <ListEmpty
        icon="heart-outline"
        title="No loved one linked yet"
        body={'When a care profile for your relative is linked to this account and a caregiver '
          + 'is assigned, their updates, care plan and visits will appear here.'}
      />
    );
  }
  return children(selected);
}
