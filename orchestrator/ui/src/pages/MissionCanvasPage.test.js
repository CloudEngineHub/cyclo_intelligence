import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MissionCanvasPage from './MissionCanvasPage';
import { getServiceStatus, startNavigation } from '../utils/navigationApi';
import { getNavigationSpots } from '../utils/navigationSpotsApi';

const mockMapViewer = jest.fn(() => <div>Mission Canvas Map</div>);

jest.mock('../components/navigation/MapViewer', () => ({
  MapViewer: (props) => mockMapViewer(props),
}));

jest.mock('../utils/navigationApi', () => ({
  getServiceStatus: jest.fn().mockResolvedValue({ is_up: false }),
  saveNavigationMap: jest.fn().mockResolvedValue({ ok: true }),
  startNavigation: jest.fn().mockResolvedValue({ ok: true }),
  stopNavigation: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../utils/navigationSpotsApi', () => ({
  createNavigationSpot: jest.fn().mockResolvedValue({
    id: 'spot_a',
    map_name: 'map',
    label: 'Spot A',
    pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
    linked_bt_tree: '',
    metadata: {},
  }),
  deleteNavigationSpot: jest.fn().mockResolvedValue({ ok: true }),
  getNavigationSpots: jest.fn().mockResolvedValue({ map_name: 'map', spots: [] }),
  updateNavigationSpot: jest.fn().mockResolvedValue({
    id: 'spot_a',
    map_name: 'map',
    label: 'Spot A',
    pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
    linked_bt_tree: '',
    metadata: {},
  }),
}));

jest.mock('../hooks/useNavigationRosTopic', () => ({
  useNavigationRosTopic: () => ({ status: 'disconnected', topicData: null }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  getServiceStatus.mockResolvedValue({ is_up: false });
  getNavigationSpots.mockResolvedValue({ map_name: 'map', spots: [] });
  startNavigation.mockResolvedValue({ ok: true });
  mockMapViewer.mockImplementation(() => <div>Mission Canvas Map</div>);
});

test('renders Mission Canvas foundation', async () => {
  render(<MissionCanvasPage />);

  expect(screen.getByRole('heading', { name: 'Mission Canvas' })).toBeInTheDocument();
  expect(screen.getByText('Mission Canvas Map')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Mapping' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Spot / BT' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Run' })).toBeInTheDocument();
  expect(screen.getByLabelText('Map name')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Map' })).toBeInTheDocument();
  expect(screen.getByText('Layers')).toBeInTheDocument();
  expect(screen.getByText('Topics')).toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
});

test('shows Spot and BT authoring panels in the authoring stage', async () => {
  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Spot / BT' }));

  expect(screen.getByText('Behavior Surface')).toBeInTheDocument();
  expect(screen.getByText('Inspector')).toBeInTheDocument();
  expect(screen.getByText('Spots')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Spot' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Spot' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create BT' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit BT' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Mapping' })).not.toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
});

test('starts mapping mode from Mission Canvas', async () => {
  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Mapping' }));

  await waitFor(() => expect(startNavigation).toHaveBeenCalledWith('map', 'map'));
});

test('enables live robot and lidar layers while navigation runtime is active', async () => {
  getServiceStatus.mockResolvedValueOnce({ is_up: true });

  render(<MissionCanvasPage />);

  await waitFor(() => {
    expect(mockMapViewer.mock.calls.some(([props]) => (
      props.showScan === true &&
      props.showRobotModel === true
    ))).toBe(true);
  });
});

test('enables navigation runtime layers in the run stage', async () => {
  getServiceStatus.mockResolvedValueOnce({ is_up: true });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Run' }));

  expect(screen.getByRole('button', { name: 'Navigation' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run BT' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save Map' })).not.toBeInTheDocument();

  await waitFor(() => {
    expect(mockMapViewer.mock.calls.some(([props]) => (
      props.showGlobalCostmap === true &&
      props.showLocalCostmap === true &&
      props.showGlobalPlan === true &&
      props.showGoalPose === true
    ))).toBe(true);
  });
});
