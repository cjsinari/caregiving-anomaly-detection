import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import StatTile from './StatTile';
import PillButton from './PillButton';

/*
 * The style split.
 *
 * Touchable animates the press on a wrapper View, which puts a box between
 * the caller and the thing being laid out. If `flex: 1` stays on the inner
 * Pressable, it flexes against the wrapper rather than against the row the
 * caller put it in -- so a stat tile in a row of three shrinks to its text
 * while its non-pressable neighbours expand, and a full-width button stops
 * being full width.
 *
 * It is a layout bug that reads as a design problem, which is exactly the
 * kind that survives review. These tests assert on the structure rather than
 * on behaviour because there is nothing to interact with: the claim is about
 * which element carries which style.
 */

/** The wrapper Animated.View that Touchable renders around its Pressable. */
const wrapperOf = (element) => element.parent;

const flat = (style) => StyleSheet.flatten(style) || {};

describe('layout goes to the wrapper', () => {
  it('lifts flex off the Pressable and onto the animated wrapper', async () => {
    await render(
      <Touchable
        onPress={() => {}}
        accessibilityLabel="Tile"
        style={{ flex: 1, padding: 16, backgroundColor: '#fff', borderRadius: 26 }}
      >
        <Text>Hello</Text>
      </Touchable>
    );

    const pressable = screen.getByLabelText('Tile');
    const wrapper = wrapperOf(pressable);

    expect(flat(wrapper.props.style).flex).toBe(1);
    // The paint stays where the ripple can be clipped by it.
    expect(flat(pressable.props.style).padding).toBe(16);
    expect(flat(pressable.props.style).borderRadius).toBe(26);
    expect(flat(wrapper.props.style).padding).toBeUndefined();
  });

  it('keeps the inner surface filling a flexed wrapper', async () => {
    await render(
      <Touchable onPress={() => {}} accessibilityLabel="Tile" style={{ flex: 1 }}>
        <Text>Hello</Text>
      </Touchable>
    );

    // Otherwise the wrapper is the right size and the thing you can see and
    // tap inside it is not.
    expect(flat(screen.getByLabelText('Tile').props.style).flex).toBe(1);
  });

  it('honours a minimum touch target on both boxes', async () => {
    await render(
      <Touchable onPress={() => {}} accessibilityLabel="Row" style={{ minHeight: 48 }}>
        <Text>Hello</Text>
      </Touchable>
    );

    const pressable = screen.getByLabelText('Row');
    expect(flat(wrapperOf(pressable).props.style).minHeight).toBe(48);
    expect(flat(pressable.props.style).minHeight).toBe(48);
  });
});

describe('the components that depend on it', () => {
  it('a tappable stat tile still shares the row equally', async () => {
    await render(
      <View style={{ flexDirection: 'row' }}>
        <StatTile value={3} label="Assigned Elders" onPress={() => {}} />
        <StatTile value={2} label="Visits Today" />
      </View>
    );

    const tappable = screen.getByLabelText('3 Assigned Elders');
    // The tappable one and the plain one both have to flex, or the row is
    // visibly lopsided.
    expect(flat(wrapperOf(tappable).props.style).flex).toBe(1);
    expect(flat(screen.getByLabelText('2 Visits Today').props.style).flex).toBe(1);
  });

  it('a full-width button is actually full width', async () => {
    await render(<PillButton label="Submit Visit Report" full onPress={() => {}} />);

    const button = screen.getByLabelText('Submit Visit Report');
    expect(flat(wrapperOf(button).props.style).alignSelf).toBe('stretch');
  });
});
