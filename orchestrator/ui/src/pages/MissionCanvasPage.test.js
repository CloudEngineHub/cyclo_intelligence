import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MissionCanvasPage from './MissionCanvasPage';
import { getServiceStatus, startNavigation } from '../utils/navigationApi';
import { getNavigationSpots } from '../utils/navigationSpotsApi';

jest.mock('../components/navigation/MapViewer', () => ({
  MapViewer: () => <div>Mission Canvas Map</div>,
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

test('renders Mission Canvas foundation', async () => {
  render(<MissionCanvasPage />);

  expect(screen.getByRole('heading', { name: 'Mission Canvas' })).toBeInTheDocument();
  expect(screen.getByText('Mission Canvas Map')).toBeInTheDocument();
  expect(screen.getByText('Behavior Surface')).toBeInTheDocument();
  expect(screen.getByText('Inspector')).toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
});

test('starts mapping mode from Mission Canvas', async () => {
  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Mapping' }));

  await waitFor(() => expect(startNavigation).toHaveBeenCalledWith('map', 'map'));
});
