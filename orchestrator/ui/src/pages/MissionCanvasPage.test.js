import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MissionCanvasPage from './MissionCanvasPage';
import {
  configureDesignLocalizationAmcl,
  getPgmFiles,
  getPgmImage,
  getServiceStatus,
  requestNoMotionUpdate,
  saveNavigationMap,
  savePgmImage,
  sendInitialPoseEstimate,
  startNavigation,
  stopNavigation,
} from '../utils/navigationApi';
import {
  createNavigationSpot,
  getNavigationSpots,
  updateNavigationSpot,
} from '../utils/navigationSpotsApi';

const mockMapViewer = jest.fn(() => <div>Mission Canvas Map</div>);
const mockPublishRosTopic = jest.fn();
const mockTopicDataByName = {};

function amclPoseMessage(x, y, yaw, covarianceValue = 0.05) {
  return {
    pose: {
      pose: {
        position: { x, y, z: 0 },
        orientation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) },
      },
      covariance: [
        covarianceValue, 0, 0, 0, 0, 0,
        0, covarianceValue, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, covarianceValue,
      ],
    },
  };
}

function stringTopicMessage(data) {
  return { available: true, data: { data } };
}

function topicRow(topic) {
  return screen.getByText(topic).parentElement;
}

jest.mock('../components/navigation/MapViewer', () => ({
  MapViewer: (props) => mockMapViewer(props),
}));

jest.mock('../utils/navigationApi', () => ({
  configureDesignLocalizationAmcl: jest.fn().mockResolvedValue({ ok: true }),
  getPgmFiles: jest.fn().mockResolvedValue({ files: [] }),
  getPgmImage: jest.fn().mockResolvedValue({
    path: 'map.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  }),
  getServiceStatus: jest.fn().mockResolvedValue({ is_up: false }),
  requestNoMotionUpdate: jest.fn().mockResolvedValue({ ok: true }),
  saveNavigationMap: jest.fn().mockResolvedValue({ ok: true }),
  savePgmImage: jest.fn().mockResolvedValue({ path: 'map.pgm', saved: true }),
  sendInitialPoseEstimate: jest.fn().mockResolvedValue({ ok: true }),
  startNavigation: jest.fn().mockResolvedValue({ ok: true }),
  stopNavigation: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../utils/navigationSpotsApi', () => ({
  createNavigationSpot: jest.fn().mockResolvedValue({
    id: 'spot_a',
    map_name: 'map',
    label: 'Waypoint A',
    pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
    linked_bt_tree: '',
    metadata: {},
  }),
  deleteNavigationSpot: jest.fn().mockResolvedValue({ ok: true }),
  getNavigationSpots: jest.fn().mockResolvedValue({ map_name: 'map', spots: [] }),
  updateNavigationSpot: jest.fn().mockResolvedValue({
    id: 'spot_a',
    map_name: 'map',
    label: 'Waypoint A',
    pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
    linked_bt_tree: '',
    metadata: {},
  }),
}));

jest.mock('../hooks/useNavigationRosTopic', () => ({
  useNavigationRosTopic: (topic) => ({
    status: topic && mockTopicDataByName[topic] ? 'connected' : 'disconnected',
    topicData: topic ? mockTopicDataByName[topic] || null : null,
  }),
  useNavigationRosPublisher: () => mockPublishRosTopic,
}));

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockTopicDataByName).forEach((topic) => {
    delete mockTopicDataByName[topic];
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockPublishRosTopic.mockResolvedValue(undefined);
  createNavigationSpot.mockResolvedValue({
    id: 'spot_a',
    map_name: 'factory',
    label: 'Waypoint A',
    pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
    linked_bt_tree: '',
    metadata: {},
  });
  updateNavigationSpot.mockImplementation((spotId, patch) => Promise.resolve({
    id: spotId,
    map_name: patch.map_name || 'factory',
    label: 'Waypoint A',
    pose: patch.pose || { frame_id: 'map', x: 1, y: 2, yaw: 0 },
    linked_bt_tree: '',
    metadata: {},
  }));
  getPgmFiles.mockResolvedValue({ files: [] });
  getPgmImage.mockResolvedValue({
    path: 'map.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });
  getServiceStatus.mockResolvedValue({ is_up: false });
  configureDesignLocalizationAmcl.mockResolvedValue({ ok: true });
  requestNoMotionUpdate.mockResolvedValue({ ok: true });
  getNavigationSpots.mockResolvedValue({ map_name: 'map', spots: [] });
  saveNavigationMap.mockResolvedValue({ ok: true, message: 'Saved map' });
  savePgmImage.mockResolvedValue({ path: 'map.pgm', saved: true });
  sendInitialPoseEstimate.mockResolvedValue({ ok: true });
  startNavigation.mockResolvedValue({ ok: true });
  stopNavigation.mockResolvedValue({ ok: true });
  mockMapViewer.mockImplementation(() => <div>Mission Canvas Map</div>);
});

test('renders Mission Canvas foundation', async () => {
  render(<MissionCanvasPage />);

  expect(screen.getByRole('heading', { name: 'Mission Canvas' })).toBeInTheDocument();
  expect(screen.getByText('Mission Canvas Map')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Mapping' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Design' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Run' })).toBeInTheDocument();
  expect(screen.getByText('Status: idle')).toBeInTheDocument();
  expect(screen.queryByLabelText('Map name')).not.toBeInTheDocument();
  expect(screen.getByText('Mapping Session')).toBeInTheDocument();
  expect(screen.getByText('Live mapping')).toBeInTheDocument();
  expect(screen.getByText('Not saved')).toBeInTheDocument();
  expect(screen.getByText('Clean')).toBeInTheDocument();
  expect(screen.queryByText('PID:')).not.toBeInTheDocument();
  expect(screen.getByText('Mapping Session').parentElement).toHaveClass('overflow-auto');
  expect(screen.getByText('Mapping Session').parentElement).toHaveClass('rounded-md');
  const startMappingButton = screen.getByRole('button', { name: 'Start Mapping' });
  const stopButton = screen.getByRole('button', { name: 'Stop' });
  const saveMapButton = screen.getByRole('button', { name: 'Save Map' });
  const mapEditorButton = screen.getByRole('button', { name: 'Map Editor' });
  expect(startMappingButton).toHaveClass('rounded-md');
  expect(Boolean(startMappingButton.compareDocumentPosition(stopButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(stopButton.compareDocumentPosition(saveMapButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(saveMapButton.compareDocumentPosition(mapEditorButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(screen.getByText('Mobile Teleop')).toBeInTheDocument();
  expect(screen.getByText('Mobile Teleop').parentElement).toHaveClass('overflow-auto');
  expect(screen.getByText('Mobile Teleop').parentElement).toHaveClass('rounded-md');
  expect(screen.getByRole('group', { name: 'Mobile Teleop' })).toBeInTheDocument();
  expect(screen.getByText('/cmd_vel')).toBeInTheDocument();
  expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();
  expect(screen.getByText('Layers')).toBeInTheDocument();
  expect(screen.getByText('Layers').parentElement).toHaveClass('overflow-auto');
  expect(screen.getByText('Layers').parentElement).toHaveClass('rounded-md');
  expect(screen.getByText('Topics')).toBeInTheDocument();
  expect(screen.getByText('/map')).toBeInTheDocument();
  expect(screen.getByText('/scan')).toBeInTheDocument();
  expect(screen.getByText('/tf')).toBeInTheDocument();
  expect(screen.queryByText('/amcl_pose')).not.toBeInTheDocument();
  expect(screen.queryByText('/global_costmap/costmap')).not.toBeInTheDocument();
  expect(screen.queryByText('/bt/status')).not.toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
});

test('updates mapping topics when layer toggles change', async () => {
  render(<MissionCanvasPage />);

  expect(screen.getByText('/scan')).toBeInTheDocument();
  expect(screen.queryByText('/amcl_pose')).not.toBeInTheDocument();
  expect(screen.getByText('/tf')).toBeInTheDocument();
  expect(screen.getByText('/tf_static')).toBeInTheDocument();
  expect(screen.getByText('/local_costmap/published_footprint')).toBeInTheDocument();
  const lidarSwitch = screen.getByRole('switch', { name: 'Lidar' });
  expect(lidarSwitch).toHaveAttribute('aria-checked', 'true');
  expect(lidarSwitch).toHaveClass('inline-flex');
  expect(lidarSwitch).toHaveStyle({ backgroundColor: '#15803d' });
  expect(lidarSwitch.firstChild).toHaveClass('rounded-full');
  expect(lidarSwitch.parentElement).toHaveClass('justify-between');
  expect(lidarSwitch.parentElement).not.toHaveClass('border');

  fireEvent.click(lidarSwitch);
  expect(lidarSwitch).toHaveAttribute('aria-checked', 'false');
  expect(lidarSwitch).toHaveStyle({ backgroundColor: '#cbd5e1' });
  expect(screen.queryByText('/scan')).not.toBeInTheDocument();
  expect(screen.queryByText('/amcl_pose')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('switch', { name: 'Robot Model' }));
  expect(screen.queryByText('/amcl_pose')).not.toBeInTheDocument();
  expect(screen.queryByText('/local_costmap/published_footprint')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('switch', { name: 'TF' }));
  expect(screen.queryByText('/tf')).not.toBeInTheDocument();
  expect(screen.queryByText('/tf_static')).not.toBeInTheDocument();

  fireEvent.click(lidarSwitch);
  expect(screen.getByText('/scan')).toBeInTheDocument();
  expect(screen.queryByText('/amcl_pose')).not.toBeInTheDocument();

  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
});

test('shows Waypoint and BT authoring panels in the authoring stage', async () => {
  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));

  expect(screen.getByText('Behavior Palette')).toBeInTheDocument();
  expect(screen.getByText('Actions')).toBeInTheDocument();
  expect(screen.getByText('Controls')).toBeInTheDocument();
  expect(screen.getByText('Decorators')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'SendCommand' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sequence' })).toBeInTheDocument();
  expect(screen.getByText('Properties')).toBeInTheDocument();
  expect(screen.getByText('Design Objects')).toBeInTheDocument();
  expect(screen.getByText('Behavior Nodes')).toBeInTheDocument();
  expect(screen.getByText('Waypoints')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load Map' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Map' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeInTheDocument();
  expect(screen.queryByRole('menu', { name: 'Waypoint creation options' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'At Robot' })).not.toBeInTheDocument();
  expect(screen.getByText('Select a waypoint or behavior node on the map.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete Waypoint' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete Node' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start Mapping' })).not.toBeInTheDocument();
  expect(screen.getByText('/map')).toBeInTheDocument();
  expect(screen.getByText('/bt/status')).toBeInTheDocument();
  expect(screen.getByText('/bt/active_nodes')).toBeInTheDocument();
  expect(topicRow('/bt/status')).toHaveTextContent('wait');
  expect(topicRow('/bt/active_nodes')).toHaveTextContent('wait');
  expect(screen.queryByText('/scan')).not.toBeInTheDocument();
  expect(screen.queryByText('/global_costmap/costmap')).not.toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
});

test('marks BT topics live when BT topic messages are available', async () => {
  mockTopicDataByName['/bt/status'] = stringTopicMessage('stopped');
  mockTopicDataByName['/bt/active_nodes'] = stringTopicMessage('');

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));

  expect(topicRow('/bt/status')).toHaveTextContent('live');
  expect(topicRow('/bt/active_nodes')).toHaveTextContent('live');
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
});

test('loads a saved map into the design stage', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));

  const mapSelect = await screen.findByRole('combobox', { name: 'Design map file' });
  await waitFor(() => expect(mapSelect).toHaveValue('factory.pgm'));

  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(getPgmImage).toHaveBeenCalledWith('factory.pgm'));
  await waitFor(() => expect(latestMapViewerProps().map).toMatchObject({
    info: { width: 1, height: 1 },
  }));
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  expect(screen.getByRole('menu', { name: 'Waypoint creation options' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'On Map' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Set Robot Pose' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'At Robot' })).toBeEnabled();
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('factory'));
});

test('hides loaded design waypoints after returning to mapping stage', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });
  getNavigationSpots.mockImplementation((mapName) => Promise.resolve({
    map_name: mapName,
    spots: mapName === 'factory' ? [{
      id: 'spot_factory',
      map_name: 'factory',
      label: 'Waypoint Factory',
      pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
      linked_bt_tree: '',
      metadata: {},
    }] : [],
  }));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));
  await screen.findByRole('combobox', { name: 'Design map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(latestMapViewerProps().spots).toHaveLength(1));

  fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));

  await waitFor(() => expect(latestMapViewerProps().spots).toEqual([]));
  expect(latestMapViewerProps().selectedSpotId).toBe('');
  expect(latestMapViewerProps().map).toBeNull();
});

test('renders legacy pixel-coordinate waypoints in loaded map coordinates', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 100,
    height: 100,
    resolution: 0.05,
    origin: {
      position: { x: -1, y: -2, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    maxval: 255,
    pixels_base64: 'AA==',
  });
  getNavigationSpots.mockResolvedValue({
    map_name: 'factory',
    spots: [{
      id: 'legacy_spot',
      map_name: 'factory',
      label: 'Legacy Waypoint',
      pose: { frame_id: 'map', x: 50, y: 20, yaw: 0.5 },
      linked_bt_tree: '',
      metadata: {},
    }],
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));
  await screen.findByRole('combobox', { name: 'Design map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(latestMapViewerProps().map).toMatchObject({
    info: { resolution: 0.05 },
  }));
  await waitFor(() => {
    expect(latestMapViewerProps().spots).toHaveLength(1);
    expect(latestMapViewerProps().spots[0].pose.x).toBeCloseTo(1.5);
    expect(latestMapViewerProps().spots[0].pose.y).toBeCloseTo(-1);
    expect(latestMapViewerProps().spots[0].metadata.coordinate_space).toBe('legacy_cell_display');
  });
});

test('shows waypoint actions in Properties after placing a waypoint', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));
  await screen.findByRole('combobox', { name: 'Design map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(latestMapViewerProps().map).toMatchObject({
    info: { width: 1, height: 1 },
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  fireEvent.click(screen.getByRole('button', { name: 'On Map' }));

  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toHaveAttribute('aria-pressed', 'true');

  await act(async () => {
    await latestMapViewerProps().onMapPose(1, 2, 0.25);
  });

  await waitFor(() => expect(createNavigationSpot).toHaveBeenCalledWith({
    map_name: 'factory',
    label: 'Waypoint 1',
    pose: { frame_id: 'map', x: 1, y: 2, yaw: 0.25 },
    metadata: { source: 'mission_canvas', coordinate_space: 'map' },
  }));
  expect(screen.getByDisplayValue('Waypoint A')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toHaveAttribute('aria-pressed', 'true');
  expect(latestMapViewerProps().interactionMode).toBe('spot');
  expect(screen.getByRole('button', { name: 'Create BT' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit BT' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Delete Waypoint' })).toBeEnabled();

  await act(async () => {
    await latestMapViewerProps().onSpotPoseChange('spot_a', 4, 5, 0.25);
  });

  await waitFor(() => expect(updateNavigationSpot).toHaveBeenCalledWith('spot_a', {
    map_name: 'factory',
    pose: { frame_id: 'map', x: 4, y: 5, yaw: 0.25 },
    metadata: { coordinate_space: 'map' },
  }));
  await waitFor(() => expect(latestMapViewerProps().spots[0].pose).toMatchObject({
    x: 4,
    y: 5,
    yaw: 0.25,
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  fireEvent.click(screen.getByRole('button', { name: 'On Map' }));
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).not.toHaveAttribute('aria-pressed');
});

test('creates a waypoint at robot with automatic localization from the waypoint menu', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getServiceStatus
    .mockResolvedValueOnce({ is_up: false })
    .mockResolvedValue({ is_up: true });
  mockTopicDataByName['/tf'] = {
    transforms: [{
      header: { frame_id: 'map' },
      child_frame_id: 'base_link',
      transform: {
        translation: { x: 1.25, y: -0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    }],
  };
  mockTopicDataByName['/amcl_pose'] = amclPoseMessage(9, 9, 0);
  sendInitialPoseEstimate.mockImplementationOnce(async () => {
    mockTopicDataByName['/amcl_pose'] = amclPoseMessage(1.25, -0.5, 0.75);
    return { ok: true };
  });
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));
  await screen.findByRole('combobox', { name: 'Design map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  expect(screen.queryByRole('button', { name: 'Set Robot Pose' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'At Robot' }));

  await waitFor(() => expect(startNavigation).toHaveBeenCalledWith('localize', 'factory'));
  await waitFor(() => expect(configureDesignLocalizationAmcl).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(latestMapViewerProps().interactionMode).toBe('initial'));
  await waitFor(() => expect(latestMapViewerProps().showScan).toBe(true));
  await act(async () => {
    latestMapViewerProps().onMapPose(1.25, -0.5, 0.75);
  });
  await waitFor(() => expect(sendInitialPoseEstimate).toHaveBeenCalledWith({
    x: 1.25,
    y: -0.5,
    yaw: 0.75,
    frameId: 'map',
    mapName: 'factory',
  }));
  await waitFor(() => expect(requestNoMotionUpdate).toHaveBeenCalledTimes(3), { timeout: 4000 });
  await waitFor(() => expect(createNavigationSpot).toHaveBeenCalled(), { timeout: 5000 });
  const [payload] = createNavigationSpot.mock.calls[0];
  expect(payload.map_name).toBe('factory');
  expect(payload.label).toBe('Waypoint 1');
  expect(payload.pose.x).toBeCloseTo(1.25);
  expect(payload.pose.y).toBeCloseTo(-0.5);
  expect(payload.pose.yaw).toBeCloseTo(0.75);
  expect(payload.metadata).toEqual({ source: 'mission_canvas', coordinate_space: 'map' });
  await waitFor(() => expect(stopNavigation).toHaveBeenCalled());
  expect(mockPublishRosTopic).not.toHaveBeenCalledWith(
    '/initialpose',
    expect.any(String),
    expect.any(Object),
  );
  await waitFor(() => expect(screen.getByText('Created Waypoint A at robot')).toBeInTheDocument());
  await waitFor(() => expect(latestMapViewerProps().showScan).toBe(false));
  expect(latestMapViewerProps().showRobotModel).toBe(false);

  fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
  const startMappingButton = screen.getByRole('button', { name: 'Start Mapping' });
  await waitFor(() => expect(latestMapViewerProps().showScan).toBe(false));
  expect(latestMapViewerProps().showRobotModel).toBe(false);
  expect(latestMapViewerProps().pose).toBeNull();
  expect(startMappingButton).toBeEnabled();
  expect(startMappingButton).not.toHaveAttribute('aria-pressed');
  expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save Map' })).toBeDisabled();
});

test('clears stale robot pose before a second at-robot waypoint attempt', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  let spotSerial = 0;
  getServiceStatus
    .mockResolvedValueOnce({ is_up: false })
    .mockResolvedValue({ is_up: true });
  createNavigationSpot.mockImplementation((payload) => {
    spotSerial += 1;
    return Promise.resolve({
      id: `spot_${spotSerial}`,
      map_name: payload.map_name,
      label: payload.label,
      pose: payload.pose,
      linked_bt_tree: '',
      metadata: payload.metadata,
    });
  });
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });
  mockTopicDataByName['/amcl_pose'] = amclPoseMessage(1, 1, 0);
  sendInitialPoseEstimate
    .mockImplementationOnce(async () => {
      mockTopicDataByName['/amcl_pose'] = amclPoseMessage(1, 1, 0.1);
      return { ok: true };
    })
    .mockImplementationOnce(async () => {
      mockTopicDataByName['/amcl_pose'] = amclPoseMessage(4.5, 5.25, 0.6);
      return { ok: true };
    });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));
  await screen.findByRole('combobox', { name: 'Design map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  fireEvent.click(screen.getByRole('button', { name: 'At Robot' }));
  await waitFor(() => expect(latestMapViewerProps().interactionMode).toBe('initial'));
  expect(configureDesignLocalizationAmcl).toHaveBeenCalledTimes(1);
  await act(async () => {
    latestMapViewerProps().onMapPose(1, 1, 0.1);
  });
  await waitFor(() => expect(createNavigationSpot).toHaveBeenCalledTimes(1), { timeout: 5000 });
  expect(createNavigationSpot.mock.calls[0][0].pose.x).toBeCloseTo(1);
  expect(createNavigationSpot.mock.calls[0][0].pose.y).toBeCloseTo(1);
  await waitFor(() => expect(stopNavigation).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeEnabled());

  mockTopicDataByName['/amcl_pose'] = amclPoseMessage(1, 1, 0.1);
  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  fireEvent.click(screen.getByRole('button', { name: 'At Robot' }));
  await waitFor(() => expect(latestMapViewerProps().interactionMode).toBe('initial'));
  expect(configureDesignLocalizationAmcl).toHaveBeenCalledTimes(2);
  await act(async () => {
    latestMapViewerProps().onMapPose(4, 5, 0.5);
  });

  await waitFor(() => expect(createNavigationSpot).toHaveBeenCalledTimes(2), { timeout: 6000 });
  const [secondPayload] = createNavigationSpot.mock.calls[1];
  expect(secondPayload.label).toBe('Waypoint 2');
  expect(secondPayload.pose.x).toBeCloseTo(4.5);
  expect(secondPayload.pose.y).toBeCloseTo(5.25);
  expect(secondPayload.pose.yaw).toBeCloseTo(0.6);
  expect(secondPayload.pose.x).not.toBeCloseTo(createNavigationSpot.mock.calls[0][0].pose.x);
  expect(stopNavigation).toHaveBeenCalledTimes(2);
});

test('syncs design localization state from navigation status mode', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  window.sessionStorage.setItem('mission_canvas_session', JSON.stringify({
    mapName: 'factory',
    workspaceStage: 'authoring',
    designMapPath: 'factory.pgm',
    navigationRuntimeMode: 'idle',
  }));
  getServiceStatus.mockResolvedValue({
    is_up: true,
    mode: 'localize',
    pid: 123,
    raw: 'up (pid 123 pgid 123) 7 seconds',
  });
  mockTopicDataByName['/tf'] = {
    transforms: [{
      header: { frame_id: 'map' },
      child_frame_id: 'base_link',
      transform: {
        translation: { x: 2.5, y: -1.25, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    }],
  };
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });

  render(<MissionCanvasPage />);

  await waitFor(() => (
    expect(screen.getByRole('tab', { name: 'Design' })).toHaveAttribute('aria-selected', 'true')
  ));
  await waitFor(() => expect(latestMapViewerProps().showScan).toBe(true));
  expect(latestMapViewerProps().showRobotModel).toBe(true);
  expect(latestMapViewerProps().pose).not.toBeNull();
});

test('creates a waypoint at the current robot pose from the design toolbar', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  const robotYaw = 0.5;
  getServiceStatus.mockResolvedValue({ is_up: true });
  mockTopicDataByName['/tf'] = {
    transforms: [{
      header: { frame_id: 'map' },
      child_frame_id: 'base_link',
      transform: {
        translation: { x: 2.5, y: -1.25, z: 0 },
        rotation: { x: 0, y: 0, z: Math.sin(robotYaw / 2), w: Math.cos(robotYaw / 2) },
      },
    }],
  };
  mockTopicDataByName['/amcl_pose'] = amclPoseMessage(8, 8, 0);
  sendInitialPoseEstimate.mockImplementationOnce(async () => {
    mockTopicDataByName['/amcl_pose'] = amclPoseMessage(2.5, -1.25, robotYaw);
    return { ok: true };
  });
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));
  await screen.findByRole('combobox', { name: 'Design map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  await waitFor(() => expect(screen.getByRole('menu', { name: 'Waypoint creation options' })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'At Robot' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'At Robot' }));

  await waitFor(() => expect(startNavigation).toHaveBeenCalledWith('localize', 'factory'));
  await waitFor(() => expect(configureDesignLocalizationAmcl).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(latestMapViewerProps().interactionMode).toBe('initial'));
  await act(async () => {
    latestMapViewerProps().onMapPose(2.25, -1, robotYaw);
  });
  await waitFor(() => expect(sendInitialPoseEstimate).toHaveBeenCalledWith({
    x: 2.25,
    y: -1,
    yaw: robotYaw,
    frameId: 'map',
    mapName: 'factory',
  }));
  await waitFor(() => expect(requestNoMotionUpdate).toHaveBeenCalledTimes(3), { timeout: 4000 });
  await waitFor(() => expect(createNavigationSpot).toHaveBeenCalled(), { timeout: 5000 });
  const [payload] = createNavigationSpot.mock.calls[0];
  expect(payload.map_name).toBe('factory');
  expect(payload.label).toBe('Waypoint 1');
  expect(payload.pose.frame_id).toBe('map');
  expect(payload.pose.x).toBeCloseTo(2.5);
  expect(payload.pose.y).toBeCloseTo(-1.25);
  expect(payload.pose.yaw).toBeCloseTo(robotYaw);
  expect(payload.metadata).toEqual({ source: 'mission_canvas', coordinate_space: 'map' });
  await waitFor(() => expect(stopNavigation).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText('Created Waypoint A at robot')).toBeInTheDocument());
});

test('places behavior palette nodes on the map overlay', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Wait' }));

  await waitFor(() => expect(latestMapViewerProps().interactionMode).toBe('behavior'));
  expect(screen.getByRole('button', { name: 'Wait' })).toHaveAttribute('aria-pressed', 'true');

  await act(async () => {
    await latestMapViewerProps().onMapPose(1.25, -0.5, 0.75);
  });

  await waitFor(() => expect(latestMapViewerProps().behaviorNodes).toHaveLength(1));
  expect(latestMapViewerProps().behaviorNodes[0]).toMatchObject({
    id: 'behavior_1_wait',
    map_name: 'map',
    tag: 'Wait',
    category: 'action',
    pose: { frame_id: 'map', x: 1.25, y: -0.5, yaw: 0.75 },
  });
  expect(latestMapViewerProps().selectedBehaviorNodeId).toBe('behavior_1_wait');
  expect(screen.getByText('behavior_1_wait')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Node' })).toBeEnabled();

  act(() => {
    latestMapViewerProps().onBehaviorNodePoseChange('behavior_1_wait', 3, 4, 0.75);
  });

  await waitFor(() => expect(latestMapViewerProps().behaviorNodes[0].pose).toMatchObject({
    x: 3,
    y: 4,
    yaw: 0.75,
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Save Map' }));

  const savedDesigns = JSON.parse(window.localStorage.getItem('mission_canvas_designs'));
  expect(savedDesigns.map.behaviorNodes[0]).toMatchObject({
    id: 'behavior_1_wait',
    map_name: 'map',
    tag: 'Wait',
  });
  expect(screen.getByText('Saved design for map')).toBeInTheDocument();
});

test('starts mapping mode from Mission Canvas', async () => {
  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Start Mapping' }));

  await waitFor(() => expect(startNavigation).toHaveBeenCalledWith('map', 'map'));
});

test('locks mapping controls while mapping is running', async () => {
  getServiceStatus
    .mockResolvedValueOnce({ is_up: true, mode: 'map' })
    .mockResolvedValueOnce({ is_up: false });

  render(<MissionCanvasPage />);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Save Map' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Start Mapping' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Map Editor' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

  await waitFor(() => expect(stopNavigation).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start Mapping' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Map Editor' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save Map' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
});

test('publishes keyboard teleop commands without mapping runtime', async () => {
  render(<MissionCanvasPage />);

  const teleop = screen.getByRole('group', { name: 'Mobile Teleop' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled());
  expect(teleop).toHaveAttribute('tabindex', '-1');

  fireEvent.keyDown(window, { key: 'w' });
  expect(mockPublishRosTopic).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument());
  expect(teleop).toHaveAttribute('tabindex', '0');

  fireEvent.keyDown(window, { key: 'w' });

  await waitFor(() => expect(mockPublishRosTopic).toHaveBeenCalledWith(
    '/cmd_vel',
    'geometry_msgs/msg/Twist',
    {
      linear: { x: 0.4, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    },
  ));

  fireEvent.keyUp(window, { key: 'w' });

  await waitFor(() => expect(mockPublishRosTopic).toHaveBeenCalledWith(
    '/cmd_vel',
    'geometry_msgs/msg/Twist',
    {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    },
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
  expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
});

test('asks for a map name before saving from Mission Canvas', async () => {
  getServiceStatus.mockResolvedValueOnce({ is_up: true, mode: 'map' });

  render(<MissionCanvasPage />);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Save Map' })).toBeEnabled());

  fireEvent.click(screen.getByRole('button', { name: 'Save Map' }));
  fireEvent.change(screen.getByLabelText('Save map name'), {
    target: { value: 'factory' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(saveNavigationMap).toHaveBeenCalledWith('factory'));
  await waitFor(() => expect(screen.getByText('Saved map')).toBeInTheDocument());
  expect(getPgmFiles).not.toHaveBeenCalled();
  expect(getPgmImage).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue('factory.pgm')).not.toBeInTheDocument();
  expect(screen.getByText('Live mapping')).toBeInTheDocument();
});

test('loads saved maps into the mapping fix editor', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Map Editor' }));

  await waitFor(() => expect(getPgmFiles).toHaveBeenCalled());
  await waitFor(() => expect(getPgmImage).toHaveBeenCalledWith('factory.pgm'));
  expect(screen.getByDisplayValue('factory.pgm')).toBeInTheDocument();
  expect(screen.getByText('Saved map')).toBeInTheDocument();
  expect(screen.getAllByText('factory.pgm').length).toBeGreaterThan(0);
  expect(latestMapViewerProps().showScan).toBe(false);
  expect(latestMapViewerProps().showMap).toBe(true);
  expect(latestMapViewerProps().waitingLabel).toBe('Select a PGM');
});

test('edits and saves loaded map pixels from the fix editor', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getPgmImage.mockResolvedValue({
    path: 'factory.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: '/g==',
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Map Editor' }));

  await waitFor(() => expect(getPgmImage).toHaveBeenCalledWith('factory.pgm'));
  fireEvent.change(screen.getByLabelText('Brush size'), {
    target: { value: '10' },
  });
  expect(screen.getByLabelText('Brush size')).toHaveValue('10');

  fireEvent.click(screen.getByRole('button', { name: 'Add Obstacle' }));
  await waitFor(() => expect(latestMapViewerProps().editorActive).toBe(true));

  await act(async () => {
    latestMapViewerProps().onEditorMapPoint(0, 0);
  });

  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled());

  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(savePgmImage).toHaveBeenCalledWith(
    'factory.pgm',
    1,
    1,
    255,
    'AA==',
  ));
});

test('enables live robot and lidar layers while navigation runtime is active', async () => {
  getServiceStatus.mockResolvedValueOnce({ is_up: true, mode: 'map' });

  render(<MissionCanvasPage />);

  await waitFor(() => {
    expect(mockMapViewer.mock.calls.some(([props]) => (
      props.showScan === true &&
      props.showRobotModel === true
    ))).toBe(true);
  });
});

test('enables navigation runtime layers in the run stage', async () => {
  getServiceStatus.mockResolvedValueOnce({ is_up: true, mode: 'run' });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Run' }));

  expect(screen.getByText('Run Session')).toBeInTheDocument();
  expect(screen.getByText('Runtime')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument());
  expect(screen.queryByText('PID:')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load Map' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run Mission' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Navigation' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Run BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save Map' })).not.toBeInTheDocument();
  expect(screen.getByText('/global_costmap/costmap')).toBeInTheDocument();
  expect(screen.getByText('/local_costmap/costmap')).toBeInTheDocument();
  expect(screen.getByText('/plan')).toBeInTheDocument();
  expect(screen.getByText('/goal_pose')).toBeInTheDocument();
  expect(screen.getByText('/bt/status')).toBeInTheDocument();
  expect(screen.queryByText('/tf')).not.toBeInTheDocument();
  await waitFor(() => {
    expect(mockMapViewer.mock.calls.some(([props]) => (
      props.showGlobalCostmap === true &&
      props.showLocalCostmap === true &&
      props.showGlobalPlan === true &&
      props.showGoalPose === true
    ))).toBe(true);
  });
  const globalCostmapSwitch = screen.getByRole('switch', { name: 'Global costmap' });
  expect(globalCostmapSwitch).toHaveAttribute('aria-checked', 'true');
  expect(globalCostmapSwitch).toHaveClass('inline-flex');
  expect(globalCostmapSwitch.firstChild).toHaveClass('rounded-full');
  expect(globalCostmapSwitch.parentElement).toHaveClass('justify-between');
  expect(globalCostmapSwitch.parentElement).not.toHaveClass('border');

  fireEvent.click(globalCostmapSwitch);
  expect(globalCostmapSwitch).toHaveAttribute('aria-checked', 'false');
  expect(screen.queryByText('/global_costmap/costmap')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('switch', { name: 'TF' }));
  expect(screen.getByText('/tf')).toBeInTheDocument();
  expect(screen.getByText('/tf_static')).toBeInTheDocument();

  expect(mockMapViewer.mock.calls.some(([props]) => (
    props.showGlobalCostmap === true &&
    props.showLocalCostmap === true &&
    props.showGlobalPlan === true &&
    props.showGoalPose === true
  ))).toBe(true);
});

test('loads a saved map for the run stage', async () => {
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Run' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Map' }));

  const mapSelect = await screen.findByRole('combobox', { name: 'Run map file' });
  await waitFor(() => expect(mapSelect).toHaveValue('factory.pgm'));

  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  expect(screen.getByText('factory')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Run Mission' }));

  await waitFor(() => expect(startNavigation).toHaveBeenCalledWith('nav', 'factory'));
});
