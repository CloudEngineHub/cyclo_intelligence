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
  deleteNavigationSpot,
  getNavigationSpots,
  updateNavigationSpot,
} from '../utils/navigationSpotsApi';
import {
  deleteNavigationMissionBtFile,
  getNavigationMission,
  getNavigationMissionBtFile,
  saveNavigationMission,
  saveNavigationMissionBtFile,
} from '../utils/navigationMissionsApi';

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

function mockJsonResponse(data, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  };
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

jest.mock('../utils/navigationMissionsApi', () => ({
  deleteNavigationMissionBtFile: jest.fn().mockResolvedValue({
    path: 'locals/waypoint_a.xml',
    content: '',
    exists: false,
  }),
  getNavigationMission: jest.fn().mockResolvedValue({
    exists: false,
    map_name: 'map',
    global_bt: 'global.xml',
    waypoints: [],
    metadata: {},
  }),
  getNavigationMissionBtFile: jest.fn().mockResolvedValue({
    path: 'global.xml',
    content: '',
    exists: false,
  }),
  saveNavigationMission: jest.fn().mockResolvedValue({
    exists: true,
    map_name: 'map',
    global_bt: 'global.xml',
    waypoints: [],
    metadata: {},
  }),
  saveNavigationMissionBtFile: jest.fn().mockResolvedValue({
    path: 'global.xml',
    content: '',
    exists: true,
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
  global.fetch = jest.fn().mockResolvedValue(mockJsonResponse({
    name: 'bt_node',
    state: 'down',
    raw: 'down',
  }));
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
    label: patch.label || 'Waypoint A',
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
  getNavigationMission.mockResolvedValue({
    exists: false,
    map_name: 'map',
    global_bt: 'global.xml',
    waypoints: [],
    metadata: {},
  });
  getNavigationMissionBtFile.mockResolvedValue({
    path: 'global.xml',
    content: '',
    exists: false,
  });
  saveNavigationMission.mockResolvedValue({
    exists: true,
    map_name: 'map',
    global_bt: 'global.xml',
    waypoints: [],
    metadata: {},
  });
  saveNavigationMissionBtFile.mockResolvedValue({
    path: 'global.xml',
    content: '',
    exists: true,
  });
  deleteNavigationMissionBtFile.mockResolvedValue({
    path: 'locals/waypoint_a.xml',
    content: '',
    exists: false,
  });
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
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));

  expect(screen.getByText('Mission Flow')).toBeInTheDocument();
  expect(screen.getAllByText('No waypoints for this map yet.').length).toBeGreaterThan(0);
  expect(screen.queryByText('Properties')).not.toBeInTheDocument();
  expect(screen.getByText('BT Runtime')).toBeInTheDocument();
  expect(screen.getByText('BT Node Unknown')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activate BT' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Deactivate BT' })).toBeDisabled();
  expect(screen.getByText('Design Objects')).toBeInTheDocument();
  expect(screen.getByText('Behavior Nodes')).toBeInTheDocument();
  expect(screen.getByText('Waypoints')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load Mission' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Mission' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeDisabled();
  expect(screen.queryByRole('menu', { name: 'Waypoint creation options' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'At Robot' })).not.toBeInTheDocument();
  expect(screen.queryByText('Select a waypoint or behavior node on the map.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Delete Waypoint/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Delete Node/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start Mapping' })).not.toBeInTheDocument();
  expect(screen.queryByText('/map')).not.toBeInTheDocument();
  expect(screen.queryByText('/bt/status')).not.toBeInTheDocument();
  expect(screen.queryByText('/bt/active_nodes')).not.toBeInTheDocument();
  expect(screen.queryByText('/scan')).not.toBeInTheDocument();
  expect(screen.queryByText('/global_costmap/costmap')).not.toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
  await waitFor(() => expect(screen.getByText('BT Node Inactive')).toBeInTheDocument());
  expect(getPgmImage).not.toHaveBeenCalled();
  expect(latestMapViewerProps().map).toBeNull();
  expect(latestMapViewerProps().waitingLabel).toBe('Load a map');
});

test('controls BT node lifecycle from the design stage', async () => {
  global.fetch
    .mockResolvedValueOnce(mockJsonResponse({
      name: 'bt_node',
      state: 'down',
      raw: 'down',
    }))
    .mockResolvedValueOnce(mockJsonResponse({
      ok: true,
      message: 'started',
    }))
    .mockResolvedValueOnce(mockJsonResponse({
      name: 'bt_node',
      state: 'up',
      raw: 'up',
    }))
    .mockResolvedValueOnce(mockJsonResponse({
      ok: true,
      message: 'stopped',
    }))
    .mockResolvedValueOnce(mockJsonResponse({
      name: 'bt_node',
      state: 'down',
      raw: 'down',
    }));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));

  await waitFor(() => expect(screen.getByText('BT Node Inactive')).toBeInTheDocument());
  expect(screen.getByText('Execution')).toBeInTheDocument();
  expect(screen.getAllByText('wait').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Activate BT' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Deactivate BT' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Activate BT' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/services/bt_node/start',
    expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ robot_type: 'ffw_sg2_rev1' }),
    }),
  ));
  await waitFor(() => expect(screen.getByText('BT Node Active')).toBeInTheDocument());
  expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  expect(screen.getByText('Waiting for run')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activate BT' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Deactivate BT' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Deactivate BT' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/services/bt_node/stop',
    expect.objectContaining({ method: 'POST' }),
  ));
  await waitFor(() => expect(screen.getByText('BT Node Inactive')).toBeInTheDocument());
  expect(screen.getAllByText('wait').length).toBeGreaterThan(0);
});

test('uses BT topic messages in the design runtime summary', async () => {
  mockTopicDataByName['/bt/status'] = stringTopicMessage('running');
  mockTopicDataByName['/bt/active_nodes'] = stringTopicMessage('MoveBase, Wait');
  global.fetch.mockResolvedValue(mockJsonResponse({
    name: 'bt_node',
    state: 'up',
    raw: 'up',
  }));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));

  expect(screen.queryByText('/bt/status')).not.toBeInTheDocument();
  expect(screen.queryByText('/bt/active_nodes')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('BT Node Active')).toBeInTheDocument());
  expect(screen.getByText('Running')).toBeInTheDocument();
  expect(screen.getByText('MoveBase, Wait')).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));

  const mapSelect = await screen.findByRole('combobox', { name: 'Design mission map file' });
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

test('restores mission manifest waypoints before legacy spots', async () => {
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
  getNavigationMission.mockImplementation((mapName) => Promise.resolve(
    mapName === 'factory'
      ? {
        exists: true,
        map_name: 'factory',
        global_bt: 'global.xml',
        waypoints: [{
          id: 'mission_pickup',
          label: 'Mission Pickup',
          pose: { frame_id: 'map', x: 3.5, y: -1.25, yaw: 1.57 },
          local_bt: 'locals/mission_pickup.xml',
          metadata: { role: 'pickup' },
        }],
        metadata: {},
      }
      : {
        exists: false,
        map_name: mapName,
        global_bt: 'global.xml',
        waypoints: [],
        metadata: {},
      },
  ));
  getNavigationSpots.mockImplementation((mapName) => Promise.resolve({
    map_name: mapName,
    spots: mapName === 'factory' ? [{
      id: 'legacy_spot',
      map_name: 'factory',
      label: 'Legacy Waypoint',
      pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
      linked_bt_tree: 'legacy.xml',
      metadata: {},
    }] : [],
  }));
  getNavigationMissionBtFile.mockImplementation((mapName, path) => Promise.resolve({
    path,
    exists: true,
    content: `<root><BehaviorTree ID="${mapName}:${path}"/></root>`,
  }));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(screen.getByText('Loaded mission factory')).toBeInTheDocument());
  await waitFor(() => expect(latestMapViewerProps().spots).toHaveLength(1));
  expect(latestMapViewerProps().spots[0]).toMatchObject({
    id: 'mission_pickup',
    map_name: 'factory',
    label: 'Mission Pickup',
    linked_bt_tree: 'locals/mission_pickup.xml',
    pose: {
      frame_id: 'map',
      x: 3.5,
      y: -1.25,
      yaw: 1.57,
    },
    metadata: {
      role: 'pickup',
      source: 'mission_manifest',
      coordinate_space: 'map',
      local_bt: 'locals/mission_pickup.xml',
    },
  });
  expect(screen.getByText('locals/mission_pickup.xml')).toBeInTheDocument();
  expect(screen.queryByText('legacy.xml')).not.toBeInTheDocument();
  expect(getNavigationSpots.mock.calls.some(([mapName]) => mapName === 'factory')).toBe(false);
  expect(getNavigationMissionBtFile).toHaveBeenCalledWith('factory', 'global.xml');
  expect(getNavigationMissionBtFile).toHaveBeenCalledWith('factory', 'locals/mission_pickup.xml');
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
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
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
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
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

test('shows waypoint actions in Design Objects after placing a waypoint', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
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
  expect(screen.getByRole('button', { name: 'Waypoint A' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toHaveAttribute('aria-pressed', 'true');
  expect(latestMapViewerProps().interactionMode).toBe('spot');
  expect(screen.queryByRole('button', { name: 'Create BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit BT' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Delete Waypoint Waypoint A/ })).toBeEnabled();

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

  fireEvent.click(screen.getByRole('button', { name: 'Save Mission' }));

  await waitFor(() => expect(saveNavigationMission).toHaveBeenCalledWith(
    'factory',
    expect.objectContaining({
      global_bt: 'global.xml',
      waypoints: [
        expect.objectContaining({
          id: 'spot_a',
          label: 'Waypoint A',
          local_bt: 'locals/waypoint_a.xml',
          pose: expect.objectContaining({
            frame_id: 'map',
            x: 4,
            y: 5,
            yaw: 0.25,
          }),
        }),
      ],
      metadata: expect.objectContaining({
        source: 'mission_canvas',
        mission_flow: expect.objectContaining({
          nodes: [expect.objectContaining({ id: 'spot_a' })],
          edges: [],
        }),
      }),
    }),
  ));
  await waitFor(() => expect(saveNavigationMissionBtFile).toHaveBeenCalledWith(
    'factory',
    'global.xml',
    expect.stringContaining('<MissionStep'),
  ));
  expect(saveNavigationMissionBtFile).not.toHaveBeenCalledWith(
    'factory',
    'compiled.xml',
    expect.any(String),
  );
  expect(saveNavigationMissionBtFile).toHaveBeenCalledWith(
    'factory',
    'locals/waypoint_a.xml',
    expect.stringContaining('<BehaviorTree ID="MainTree"/>'),
  );
  await waitFor(() => expect(screen.getByText('Saved mission for factory')).toBeInTheDocument());

  await act(async () => {
    latestMapViewerProps().onMapClick(0, 0);
  });
  await waitFor(() => expect(latestMapViewerProps().selectedSpotId).toBe(''));
  expect(screen.queryByRole('button', { name: 'Create BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit BT' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Create Waypoint' }));
  fireEvent.click(screen.getByRole('button', { name: 'On Map' }));
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).not.toHaveAttribute('aria-pressed');

  fireEvent.doubleClick(screen.getByRole('button', { name: 'Waypoint A' }));
  const waypointNameInput = screen.getByRole('textbox', { name: 'Waypoint name' });
  expect(waypointNameInput).toHaveValue('Waypoint A');
  fireEvent.change(waypointNameInput, { target: { value: 'Pickup A' } });
  fireEvent.keyDown(waypointNameInput, { key: 'Enter' });

  await waitFor(() => expect(updateNavigationSpot).toHaveBeenCalledWith('spot_a', {
    map_name: 'factory',
    label: 'Pickup A',
  }));
  expect(screen.getByRole('button', { name: 'Pickup A' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save Mission' }));
  await waitFor(() => expect(saveNavigationMission).toHaveBeenLastCalledWith(
    'factory',
    expect.objectContaining({
      waypoints: [
        expect.objectContaining({
          label: 'Pickup A',
          local_bt: 'locals/pickup_a.xml',
        }),
      ],
    }),
  ));
  expect(saveNavigationMissionBtFile).toHaveBeenCalledWith(
    'factory',
    'locals/pickup_a.xml',
    expect.any(String),
  );
  await waitFor(() => expect(deleteNavigationMissionBtFile).toHaveBeenCalledWith(
    'factory',
    'locals/waypoint_a.xml',
  ));

  fireEvent.click(screen.getByRole('button', { name: /Delete Waypoint Pickup A/ }));
  await waitFor(() => expect(deleteNavigationSpot).toHaveBeenCalledWith('spot_a', 'factory'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Pickup A' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Save Mission' }));
  await waitFor(() => expect(deleteNavigationMissionBtFile).toHaveBeenCalledWith(
    'factory',
    'locals/pickup_a.xml',
  ));
});

test('opens waypoint BT map layer when selecting a waypoint with BT active', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  global.fetch.mockResolvedValue(mockJsonResponse({
    name: 'bt_node',
    state: 'up',
    raw: 'up',
  }));
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
      pose: { frame_id: 'map', x: 1, y: 2, yaw: 0.25 },
      linked_bt_tree: 'factory_waypoint.xml',
      metadata: {},
    }] : [],
  }));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(latestMapViewerProps().spots).toHaveLength(1));
  await waitFor(() => expect(screen.getByText('BT Node Active')).toBeInTheDocument());
  expect(latestMapViewerProps().onSpotPoseChange).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toBeDisabled();

  act(() => {
    latestMapViewerProps().onSpotClick('spot_factory');
  });

  await waitFor(() => expect(latestMapViewerProps().btLayer).toMatchObject({
    spot: {
      id: 'spot_factory',
      label: 'Waypoint Factory',
      linked_bt_tree: 'factory_waypoint.xml',
    },
    nodeLabel: 'Active',
    executionLabel: 'Ready',
    activeNodesLabel: 'Waiting for run',
  }));
  expect(screen.queryByRole('dialog', { name: 'Waypoint BT' })).not.toBeInTheDocument();
  expect(screen.getAllByText('Waypoint Factory').length).toBeGreaterThan(0);
  expect(screen.getAllByText('factory_waypoint.xml').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Create BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit BT' })).not.toBeInTheDocument();

  act(() => {
    latestMapViewerProps().onMapClick(0, 0);
  });

  await waitFor(() => expect(latestMapViewerProps().btLayer).toBeNull());
  expect(latestMapViewerProps().selectedSpotId).toBe('spot_factory');
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
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
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
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
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
}, 10000);

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
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
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

test('renders waypoint sequence in the mission flow panel', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'map.pgm', name: 'map.pgm' }],
  });
  getNavigationSpots.mockImplementation((mapName) => Promise.resolve({
    map_name: mapName,
    spots: mapName === 'map' ? [{
      id: 'spot_a',
      map_name: 'map',
      label: 'Waypoint A',
      pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
      linked_bt_tree: 'waypoint_a.xml',
      metadata: {},
    }] : [],
  }));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(latestMapViewerProps().map).not.toBeNull());
  await waitFor(() => expect(latestMapViewerProps().spots).toHaveLength(1));

  expect(screen.getByText('Mission Flow')).toBeInTheDocument();
  expect(screen.getAllByText('Waypoint A').length).toBeGreaterThan(0);
  expect(screen.getByText('waypoint_a.xml')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Waypoint A' }));

  await waitFor(() => expect(latestMapViewerProps().selectedSpotId).toBe('spot_a'));
  expect(screen.queryByRole('button', { name: 'Create BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit BT' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'Load Mission' })).toBeInTheDocument();
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
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'factory.pgm', name: 'factory.pgm' }],
  });
  getNavigationMission.mockImplementation((mapName) => Promise.resolve(
    mapName === 'factory'
      ? {
        exists: true,
        map_name: 'factory',
        global_bt: 'global.xml',
        waypoints: [{
          id: 'run_waypoint',
          label: 'Run Waypoint',
          pose: { frame_id: 'map', x: 1, y: 2, yaw: 0.5 },
          local_bt: 'locals/run_waypoint.xml',
          metadata: {},
        }],
        metadata: {},
      }
      : {
        exists: false,
        map_name: mapName,
        global_bt: 'global.xml',
        waypoints: [],
        metadata: {},
      },
  ));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Run' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));

  const mapSelect = await screen.findByRole('combobox', { name: 'Run mission map file' });
  await waitFor(() => expect(mapSelect).toHaveValue('factory.pgm'));

  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(screen.getByText('Loaded mission factory')).toBeInTheDocument());
  expect(screen.getByText('factory')).toBeInTheDocument();
  await waitFor(() => expect(latestMapViewerProps().spots).toHaveLength(1));
  expect(latestMapViewerProps().spots[0]).toMatchObject({
    id: 'run_waypoint',
    label: 'Run Waypoint',
    linked_bt_tree: 'locals/run_waypoint.xml',
  });
  expect(getNavigationSpots.mock.calls.some(([mapName]) => mapName === 'factory')).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Run Mission' }));

  await waitFor(() => expect(startNavigation).toHaveBeenCalledWith('nav', 'factory'));
});
