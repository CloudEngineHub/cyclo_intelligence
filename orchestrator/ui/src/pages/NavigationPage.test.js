import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import NavigationPage from './NavigationPage';
import store from '../store/store';
import { getServiceStatus } from '../utils/navigationApi';

const mockMapViewer = jest.fn(() => <div>Navigation Map Viewer</div>);
const mockTopicDataByName = {};

jest.mock('../components/navigation/MapViewer', () => ({
  MapViewer: (props) => mockMapViewer(props),
}));

jest.mock('../utils/navigationApi', () => ({
  cancelNavigateToPoseGoal: jest.fn().mockResolvedValue({ ok: true }),
  getServiceStatus: jest.fn().mockResolvedValue({ is_up: false }),
  saveNavigationMap: jest.fn().mockResolvedValue({ ok: true }),
  sendNavigateToPoseGoal: jest.fn().mockResolvedValue({ ok: true }),
  startNavigation: jest.fn().mockResolvedValue({ ok: true }),
  stopNavigation: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../hooks/useNavigationRosTopic', () => ({
  useNavigationRosPublisher: () => jest.fn(),
  useNavigationRosTopic: (topic) => ({
    status: topic && mockTopicDataByName[topic] ? 'connected' : 'disconnected',
    topicData: topic ? mockTopicDataByName[topic] || null : null,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockMapViewer.mockImplementation(() => <div>Navigation Map Viewer</div>);
  Object.keys(mockTopicDataByName).forEach((topic) => delete mockTopicDataByName[topic]);
  window.localStorage.clear();
  getServiceStatus.mockResolvedValue({ is_up: false });
});

test('renders the Navigation page shell', async () => {
  render(
    <Provider store={store}>
      <NavigationPage />
    </Provider>
  );

  expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mapping' })).toBeInTheDocument();
  expect(screen.getByText('Navigation Map Viewer')).toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
});

test('uses synchronized SLAM and odometry poses while Mapping', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getServiceStatus.mockResolvedValue({ is_up: true, mode: 'map' });
  mockTopicDataByName['/tf'] = {
    transforms: [
      {
        header: { frame_id: 'map', stamp: { sec: 10, nanosec: 0 } },
        child_frame_id: 'odom',
        transform: {
          translation: { x: 50, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      {
        header: { frame_id: 'odom', stamp: { sec: 10, nanosec: 0 } },
        child_frame_id: 'base_link',
        transform: {
          translation: { x: 99, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    ],
  };
  mockTopicDataByName['/scan'] = {
    header: { frame_id: 'base_link', stamp: { sec: 10, nanosec: 0 } },
    ranges: [1],
  };
  mockTopicDataByName['/pose'] = {
    header: { frame_id: 'map', stamp: { sec: 10, nanosec: 0 } },
    pose: { pose: { position: { x: 1.25, y: -0.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
  };
  mockTopicDataByName['/odom'] = {
    header: { frame_id: 'odom', stamp: { sec: 10, nanosec: 0 } },
    child_frame_id: 'base_link',
    pose: { pose: { position: { x: 2, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
  };

  render(
    <Provider store={store}>
      <NavigationPage />
    </Provider>
  );

  await waitFor(() => expect(latestMapViewerProps().pose).toMatchObject({
    position: { x: 1.25, y: -0.5 },
  }));
  await waitFor(() => expect(latestMapViewerProps().scanPose).toMatchObject({
    position: { x: 1.25, y: -0.5 },
  }));
  await waitFor(() => expect(latestMapViewerProps().tf.transforms.find((transform) => (
    transform.header.frame_id === 'map' && transform.child_frame_id === 'odom'
  ))).toMatchObject({ transform: { translation: { x: -0.75, y: -0.5 } } }));
  expect(latestMapViewerProps().tf.transforms.find((transform) => (
    transform.header.frame_id === 'odom' && transform.child_frame_id === 'base_link'
  ))).toMatchObject({ transform: { translation: { x: 2, y: 0 } } });
});
