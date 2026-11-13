import { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import PortalShell from '../../components/caregiver/PortalShell';
import Touchable from '../../components/oneui/Touchable';
import PillButton from '../../components/oneui/PillButton';
import { ListEmpty, ListError, ListSkeleton } from '../../components/oneui/ListState';
import UpdateItem from '../../components/family/UpdateItem';
import RecipientSwitcher from '../../components/family/RecipientSwitcher';
import FamilyGate from '../../components/family/FamilyGate';
import usePagedFeed from '../../hooks/usePagedFeed';
import { family } from '../../api/family';
import { useFamily } from '../../family/FamilyContext';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * Every visit, note and incident, newest first: item 2 of issue #45.
 *
 * ── Why this screen does not use the shell's scroller ──
 *
 * PortalShell owns a ScrollView so the One UI title can collapse as the page
 * scrolls. A FlatList inside a ScrollView stops being a FlatList: it renders
 * every row at once (the outer view gives it infinite height, so everything is
 * "visible"), and onEndReached fires immediately and keeps firing, because the
 * list believes it is always at its end. On a feed whose whole point is to page
 * in, that is three weeks of history requested in the first second.
 *
 * So this screen passes `scroll={false}`, keeps the shell's bar and sidebar,
 * and lets the FlatList own both the scrolling and the pull-to-refresh.
 *
 * ── Filters are requests, not hiding ──
 *
 * Choosing "Incidents" asks the service for incidents, page by page. Filtering
 * the pages already loaded would show "no incidents" whenever the one incident
 * happened to be on page four, which is precisely the item someone choosing
 * that filter is looking for.
 */
const FILTERS = [
  { value: null, label: 'All' },
  { value: 'visit', label: 'Visits' },
  { value: 'note', label: 'Notes' },
  { value: 'incident', label: 'Incidents' },
];

const PAGE_SIZE = 10;

export default function CareUpdatesScreen({ navigation }) {
  const { selected, displayName } = useFamily();
  const name = displayName(selected);

  return (
    <PortalShell
      navigation={navigation}
      active="CareUpdates"
      barTitle="Care Updates"
      title="Care Updates"
      subtitle={selected ? `Everything the care team has recorded about ${name}` : null}
      scroll={false}
    >
      <View style={styles.flex}>
        <FamilyGate>
          {(recipient) => <Feed recipient={recipient} name={name} />}
        </FamilyGate>
      </View>
    </PortalShell>
  );
}

function Feed({ recipient, name }) {
  const [kind, setKind] = useState(null);

  const loadPage = useCallback(
    ({ cursor }) => family.updates({ recipientId: recipient.id, cursor, limit: PAGE_SIZE, kind }),
    [recipient.id, kind]
  );
  const feed = usePagedFeed(loadPage, [recipient.id, kind]);

  const filterLabel = FILTERS.find((f) => f.value === kind)?.label.toLowerCase();

  const header = (
    <View>
      <RecipientSwitcher />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        accessibilityRole="radiogroup"
        accessibilityLabel="Show which updates"
      >
        {FILTERS.map((f) => {
          const active = f.value === kind;
          return (
            <Touchable
              key={f.label}
              onPress={() => setKind(f.value)}
              style={[styles.filter, active && styles.filterActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={f.label}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{f.label}</Text>
            </Touchable>
          );
        })}
      </ScrollView>

      {/* A failed refresh keeps the list and says so above it. */}
      {feed.status === 'error' && feed.items.length ? (
        <View style={styles.banner}>
          <ListError error={feed.error} onRetry={feed.refresh} title="Could not refresh" />
        </View>
      ) : null}
    </View>
  );

  /*
   * The bottom of the list, which has four honest states: more is loading,
   * loading more failed, there is more (nothing to draw; onEndReached will
   * ask), or this is the beginning of the record. The last one is said, so
   * the end of the feed does not look like the feed stopped loading.
   */
  const footer = (() => {
    if (feed.loadingMore) {
      return (
        <View style={styles.footer} accessibilityLabel="Loading older updates">
          <ActivityIndicator color={colors.teal} />
        </View>
      );
    }
    if (feed.pageError) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerError} accessibilityLiveRegion="polite">
            {feed.pageError.message || 'Could not load older updates.'}
          </Text>
          <PillButton label="Try again" icon="refresh" variant="tonal" size="sm" onPress={feed.loadMore} />
        </View>
      );
    }
    if (!feed.hasMore && feed.items.length) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerEnd}>That is everything recorded so far.</Text>
        </View>
      );
    }
    return <View style={styles.footerSpacer} />;
  })();

  if (feed.status === 'loading' && !feed.items.length) {
    return (
      <View style={styles.pad}>
        {header}
        <ListSkeleton rows={4} height={120} />
      </View>
    );
  }

  if (feed.status === 'error' && !feed.items.length) {
    return (
      <View style={styles.pad}>
        {header}
        <ListError error={feed.error} onRetry={feed.refresh} title="Could not load the updates" />
      </View>
    );
  }

  return (
    <FlatList
      testID="care-updates-feed"
      data={feed.items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <UpdateItem update={item} displayName={name} />}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={(
        <ListEmpty
          icon={kind === 'incident' ? 'shield-checkmark-outline' : 'pulse-outline'}
          title={kind === 'incident' ? 'No incidents recorded' : `No ${filterLabel || 'updates'} yet`}
          body={kind === 'incident'
            ? `Nothing has gone wrong on a visit to ${name}. If it ever does, it will be here.`
            : `After each visit, the caregiver's report on ${name} appears here.`}
        />
      )}
      contentContainerStyle={styles.list}
      onEndReached={feed.hasMore && !feed.pageError ? feed.loadMore : undefined}
      onEndReachedThreshold={0.4}
      refreshControl={(
        <RefreshControl
          refreshing={feed.refreshing}
          onRefresh={feed.refresh}
          tintColor={colors.teal}
          colors={[colors.teal]}
          progressBackgroundColor={colors.surface}
        />
      )}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: space.lg },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },
  separator: { height: space.md },

  filters: { gap: space.sm, paddingBottom: space.lg },
  filter: {
    minHeight: TOUCH_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: oneui.radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
  },
  filterActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  filterText: { ...type.captionMedium, color: colors.inkMuted },
  filterTextActive: { fontFamily: type.button.fontFamily, color: colors.onTeal },

  banner: { marginBottom: space.lg },

  footer: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  footerSpacer: { height: space.xl },
  footerError: { ...type.caption, color: colors.danger, textAlign: 'center' },
  footerEnd: { ...type.caption, color: colors.placeholder },
});
