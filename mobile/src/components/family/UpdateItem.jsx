import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../oneui/Card';
import Chip from '../oneui/Chip';
import { colors, oneui, space, type } from '../../theme/tokens';
import { dayAndTime, duration } from '../../utils/datetime';
import { wellbeingFor } from '../../constants/wellbeing';

/*
 * One entry in the care updates feed: a completed visit, a care note, or an
 * incident.
 *
 * ── An incident looks different, deliberately ──
 *
 * Not louder -- the feed is read by worried people and a red card shouting
 * from the middle of a quiet week does nobody any good -- but unmistakable:
 * an amber edge, its own icon, the word "Incident" in a chip, and the whole
 * account in the caregiver's words, not truncated. A family member skimming
 * thirty routine visits must not be able to scroll past the one that matters.
 *
 * ── A visit carries its evidence ──
 *
 * The wellbeing the caregiver chose, how many of the planned tasks were done,
 * and how long they were there. Those three answer "was she alright, did she
 * get her care, did anyone actually stay" -- the questions behind most calls
 * to a care agency -- without the call. The duration is computed from the
 * recorded check-in and check-out, never from anything typed (see the visit
 * report screen in #44 for why that distinction matters).
 */

const KINDS = {
  visit: { icon: 'checkmark-circle', tint: colors.success, bg: colors.successBg, label: 'Visit' },
  note: { icon: 'document-text', tint: colors.info, bg: colors.infoBg, label: 'Care note' },
  incident: { icon: 'warning', tint: colors.warning, bg: colors.warningBg, label: 'Incident' },
};

export default function UpdateItem({ update, displayName, truncate = false }) {
  const kind = KINDS[update.kind] || KINDS.note;
  const incident = update.kind === 'incident';
  const visit = update.visit;
  const mood = visit ? wellbeingFor(visit.wellbeing) : null;
  const length = visit ? duration(visit.checkInAt, visit.checkOutAt) : null;

  const spoken = [
    incident ? 'Incident.' : null,
    update.title,
    dayAndTime(update.at),
    update.author ? `by ${update.author}.` : null,
    mood ? `${displayName || 'They'} seemed ${mood.label.toLowerCase()}.` : null,
    visit?.tasksTotal ? `${visit.tasksDone} of ${visit.tasksTotal} tasks done.` : null,
    length ? `On site for ${length}.` : null,
    update.body,
  ].filter(Boolean).join(' ');

  return (
    <Card
      style={[styles.card, incident && styles.incident]}
      accessible
      accessibilityLabel={spoken}
    >
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: kind.bg }]}>
          <Ionicons name={kind.icon} size={16} color={kind.tint} />
        </View>
        <View style={styles.headText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{update.title || kind.label}</Text>
            {incident ? <Chip tone="attention" label="Incident" compact /> : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {[dayAndTime(update.at), update.author].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      {visit ? (
        <View style={styles.facts}>
          {mood ? (
            <View style={styles.fact}>
              <Text style={styles.factEmoji}>{mood.emoji}</Text>
              <Text style={[styles.factText, { color: mood.tone }]}>{mood.label}</Text>
            </View>
          ) : null}
          {visit.tasksTotal ? (
            <View style={styles.fact}>
              <Ionicons name="checkbox-outline" size={13} color={colors.label} />
              <Text style={styles.factText}>{`${visit.tasksDone}/${visit.tasksTotal} tasks`}</Text>
            </View>
          ) : null}
          {length ? (
            <View style={styles.fact}>
              <Ionicons name="time-outline" size={13} color={colors.label} />
              <Text style={styles.factText}>{length}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {update.body ? (
        <Text
          style={styles.body}
          // An incident is never cut short, even in the dashboard's preview.
          numberOfLines={truncate && !incident ? 2 : undefined}
        >
          {update.body}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  incident: { borderLeftWidth: 4, borderLeftColor: colors.warning },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...type.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
  meta: { ...type.caption, fontSize: 12, color: colors.inkMuted },

  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    backgroundColor: colors.field,
    borderRadius: oneui.radius.pill,
    paddingHorizontal: space.md - 2,
    paddingVertical: space.xs,
  },
  factEmoji: { fontSize: 13, lineHeight: 17 },
  factText: { ...type.captionMedium, fontSize: 11, color: colors.inkMuted },

  body: { ...type.body, fontSize: 14, color: colors.inkMuted },
});
