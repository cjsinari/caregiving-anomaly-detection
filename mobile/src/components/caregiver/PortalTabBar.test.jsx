import { render, fireEvent, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';
import PortalTabBar from './PortalTabBar';
import { PortalChromeProvider } from './PortalChrome';
import { CAREGIVER_PORTAL, FAMILY_PORTAL } from '../../navigation/portals';

/*
 * Item 1 of issue #46: the bottom tab bar, one per role.
 *
 * Drawn from the same portal definition the sidebar uses, so the two cannot
 * offer different destinations; shown on a phone and hidden on a wide screen,
 * where the permanent sidebar already is the navigation.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 2, fontScale: 1 })),
}));

const stateFor = (portal, index = 0) => ({
  index,
  routes: portal.tabs.map((name) => ({ key: `${name}-key`, name })),
});

const navigation = () => ({ navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) });

const renderBar = async (portal, nav, index = 0) => render(
  <PortalChromeProvider portal={portal}>
    <PortalTabBar state={stateFor(portal, index)} navigation={nav} insets={{ bottom: 20 }} />
  </PortalChromeProvider>
);

beforeEach(() => {
  useWindowDimensions.mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });
});

describe('on a phone', () => {
  it('shows the caregiver’s four tabs, the current one selected', async () => {
    await renderBar(CAREGIVER_PORTAL, navigation());

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Home', 'Assignments', 'Report', 'Account']);
    expect(screen.getByLabelText('Home').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('Assignments').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('shows the family member’s five tabs, and no caregiver ones', async () => {
    await renderBar(FAMILY_PORTAL, navigation());

    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel))
      .toEqual(['Home', 'Updates', 'Care Plan', 'Schedule', 'Account']);
    expect(screen.queryByLabelText('Assignments')).toBeNull();
  });

  it('moves to a tab when it is pressed', async () => {
    const nav = navigation();
    await renderBar(CAREGIVER_PORTAL, nav);

    await fireEvent.press(screen.getByLabelText('Assignments'));

    expect(nav.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'tabPress', target: 'Assignments-key' }));
    expect(nav.navigate).toHaveBeenCalledWith('Assignments', undefined);
  });

  it('does nothing when the current tab is pressed again', async () => {
    const nav = navigation();
    await renderBar(CAREGIVER_PORTAL, nav, 1);

    await fireEvent.press(screen.getByLabelText('Assignments'));
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});

describe('on a wide screen', () => {
  it('draws nothing, because the sidebar is already the navigation', async () => {
    useWindowDimensions.mockReturnValue({ width: 1024, height: 768, scale: 2, fontScale: 1 });
    await renderBar(CAREGIVER_PORTAL, navigation());

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});
