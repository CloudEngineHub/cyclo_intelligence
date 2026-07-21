import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MissionCanvasPage from './MissionCanvasPage';
import {
  configureDesignLocalizationAmcl,
  getMapAnnotations,
  getPgmFiles,
  getPgmImage,
  getServiceStatus,
  requestNoMotionUpdate,
  saveNavigationMap,
  saveMapAnnotations,
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
  getMapAnnotations: jest.fn().mockResolvedValue({ path: 'map.pgm', annotations: [] }),
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
  saveMapAnnotations: jest.fn().mockImplementation((path, annotations) => Promise.resolve({ path, annotations, saved: true })),
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
  getMapAnnotations.mockResolvedValue({ path: 'map.pgm', annotations: [] });
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
  saveMapAnnotations.mockImplementation((path, annotations) => Promise.resolve({ path, annotations, saved: true }));
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
  // Layers is now a glass popover over the map (not a docked panel), so only its
  // presence + the switch structure below are asserted.
  expect(screen.getByText('Layers')).toBeInTheDocument();
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
  expect(lidarSwitch).toHaveStyle({ backgroundColor: '#5b8266' });
  expect(lidarSwitch.firstChild).toHaveClass('rounded-full');
  expect(lidarSwitch.parentElement).toHaveClass('justify-between');
  expect(lidarSwitch.parentElement).not.toHaveClass('border');

  fireEvent.click(lidarSwitch);
  expect(lidarSwitch).toHaveAttribute('aria-checked', 'false');
  expect(lidarSwitch).toHaveStyle({ backgroundColor: '#dcd7ca' });
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

  expect(screen.queryByText('Mission Flow')).not.toBeInTheDocument();
  expect(screen.queryByText('Properties')).not.toBeInTheDocument();
  expect(screen.getByText('BT Runtime')).toBeInTheDocument();
  expect(screen.getByText('BT Node Unknown')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activate BT' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Deactivate BT' })).toBeDisabled();
  expect(screen.getByText('Waypoints')).toBeInTheDocument();
  expect(screen.queryByText('Behavior Nodes')).not.toBeInTheDocument();
  expect(screen.queryByText('No behavior nodes placed yet.')).not.toBeInTheDocument();
  expect(screen.queryByText('Waypoints / Local BT')).not.toBeInTheDocument();
  expect(screen.getByText('Mission Route')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load Mission' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Mission' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit On Map' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Add Selected' })).not.toBeInTheDocument();
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
  expect(latestMapViewerProps().missionRouteOrder).toEqual([]);
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
  getMapAnnotations.mockResolvedValue({
    path: 'factory.pgm',
    annotations: [{
      id: 'area_dock',
      label: 'Dock',
      color: '#3B241F',
      pose: { frame_id: 'map', x: 0.5, y: 0.5, yaw: 0 },
      region: {
        seed_cell: { x: 0, y: 0 },
        bounds: { x_min: 0, y_min: 0, x_max: 0, y_max: 0 },
        cell_count: 1,
        width: 1,
        height: 1,
      },
    }],
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));

  const mapSelect = await screen.findByRole('combobox', { name: 'Design mission map file' });
  await waitFor(() => expect(mapSelect).toHaveValue('factory.pgm'));

  fireEvent.click(screen.getByRole('button', { name: 'Load' }));

  await waitFor(() => expect(getPgmImage).toHaveBeenCalledWith('factory.pgm'));
  await waitFor(() => expect(getMapAnnotations).toHaveBeenCalledWith('factory.pgm'));
  await waitFor(() => expect(latestMapViewerProps().map).toMatchObject({
    info: { width: 1, height: 1 },
  }));
  await waitFor(() => expect(latestMapViewerProps().mapAnnotations).toEqual([
    expect.objectContaining({
      label: 'Dock',
      color: '#3B241F',
      region: expect.objectContaining({
        bounds: { x_min: 0, y_min: 0, x_max: 0, y_max: 0 },
      }),
    }),
  ]));
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
  expect(screen.getByRole('button', { name: 'Mission Pickup' })).toBeInTheDocument();
  expect(latestMapViewerProps().missionRouteOrder).toEqual([]);
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

test('shows waypoint actions in Waypoints after placing a waypoint', async () => {
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
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).not.toHaveAttribute('aria-pressed', 'true');
  expect(latestMapViewerProps().interactionMode).toBe('view');
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
    expect.stringContaining('<Sequence name="GlobalMission"/>'),
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
  expect(screen.getByRole('button', { name: 'Create Waypoint' })).toHaveAttribute('aria-pressed', 'true');

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
  expect(screen.queryByText('factory_waypoint.xml')).not.toBeInTheDocument();
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

test('edits the mission route directly on the map', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  getPgmFiles.mockResolvedValue({
    files: [{ path: 'map.pgm', name: 'map.pgm' }],
  });
  getNavigationSpots.mockImplementation((mapName) => Promise.resolve({
    map_name: mapName,
    spots: mapName === 'map' ? [
      {
        id: 'spot_a',
        map_name: 'map',
        label: 'Waypoint A',
        pose: { frame_id: 'map', x: 1, y: 2, yaw: 0 },
        linked_bt_tree: 'waypoint_a.xml',
        metadata: {},
      },
      {
        id: 'spot_b',
        map_name: 'map',
        label: 'Waypoint B',
        pose: { frame_id: 'map', x: 3, y: 4, yaw: 0.5 },
        linked_bt_tree: 'waypoint_b.xml',
        metadata: {},
      },
      {
        id: 'spot_c',
        map_name: 'map',
        label: 'Waypoint C',
        pose: { frame_id: 'map', x: 5, y: 6, yaw: 0.75 },
        linked_bt_tree: 'waypoint_c.xml',
        metadata: {},
      },
      {
        id: 'spot_d',
        map_name: 'map',
        label: 'Waypoint D',
        pose: { frame_id: 'map', x: 7, y: 8, yaw: 1 },
        linked_bt_tree: 'waypoint_d.xml',
        metadata: {},
      },
    ] : [],
  }));

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load Mission' }));
  await screen.findByRole('combobox', { name: 'Design mission map file' });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(latestMapViewerProps().map).not.toBeNull());
  await waitFor(() => expect(latestMapViewerProps().spots).toHaveLength(4));

  expect(screen.getAllByText('Waypoint A').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Waypoint B').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Waypoint C').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Waypoint D').length).toBeGreaterThan(0);
  expect(latestMapViewerProps().missionRouteOrder).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: 'Edit On Map' }));

  await waitFor(() => expect(latestMapViewerProps().missionRouteMode).toBe(true));
  expect(latestMapViewerProps().onSpotPoseChange).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Clear Route' })).not.toBeInTheDocument();

  act(() => {
    latestMapViewerProps().onMissionRouteSpotClick('spot_b');
  });
  await waitFor(() => expect(latestMapViewerProps().selectedMissionRouteSourceId).toBe('spot_b'));

  act(() => {
    latestMapViewerProps().onMissionRouteSpotClick('spot_a');
  });
  expect(latestMapViewerProps().missionRouteOrder).toEqual([
    { id: 'spot_b', order: 1 },
    { id: 'spot_a', order: 2 },
  ]);

  act(() => {
    latestMapViewerProps().onMissionRouteSpotClick('spot_b');
  });
  await waitFor(() => expect(latestMapViewerProps().selectedMissionRouteSourceId).toBe(''));
  expect(latestMapViewerProps().missionRouteOrder).toEqual([
    { id: 'spot_b', order: 1 },
    { id: 'spot_a', order: 2 },
  ]);

  fireEvent.click(screen.getByRole('button', { name: 'Save Mission' }));

  await waitFor(() => expect(saveNavigationMission).toHaveBeenCalledWith(
    'map',
    expect.objectContaining({
      waypoints: expect.arrayContaining([
        expect.objectContaining({ id: 'spot_a' }),
        expect.objectContaining({ id: 'spot_b' }),
        expect.objectContaining({ id: 'spot_c' }),
        expect.objectContaining({ id: 'spot_d' }),
      ]),
      metadata: expect.objectContaining({
        mission_flow: expect.objectContaining({
          edges: [
            expect.objectContaining({ source: 'spot_b', target: 'spot_a' }),
            expect.objectContaining({ source: 'spot_a', target: 'spot_b' }),
          ],
        }),
      }),
    }),
  ));
  await waitFor(() => {
    const globalSave = saveNavigationMissionBtFile.mock.calls.find(([mapName, path]) => (
      mapName === 'map' && path === 'global.xml'
    ));
    expect(globalSave).toBeTruthy();
    const globalXml = globalSave[2];
    expect(globalXml.match(/<MissionStep/g)).toHaveLength(3);
    expect(globalXml).toMatch(/waypoint_id="spot_b"[\s\S]*waypoint_id="spot_a"[\s\S]*waypoint_id="spot_b"/);
  });
  expect(screen.queryByRole('button', { name: 'Create BT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit BT' })).not.toBeInTheDocument();

  const deleteWaypointAButtons = screen.getAllByRole('button', { name: 'Delete Waypoint Waypoint A' });
  expect(deleteWaypointAButtons).toHaveLength(2);
  fireEvent.click(deleteWaypointAButtons[1]);

  await waitFor(() => expect(deleteNavigationSpot).toHaveBeenCalledWith('spot_a', 'map'));
  await waitFor(() => expect(latestMapViewerProps().spots.map((spot) => spot.id)).toEqual([
    'spot_b',
    'spot_c',
    'spot_d',
  ]));
  expect(latestMapViewerProps().missionRouteOrder).toEqual([]);
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
  // Brush size is now a segmented S/M/L/XL group (XL = 10 cells) instead of a <select>.
  fireEvent.click(screen.getByRole('button', { name: 'Brush size XL' }));
  expect(screen.getByRole('button', { name: 'Brush size XL' })).toHaveAttribute('aria-pressed', 'true');

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

test('marks free-space areas with automatic color and undo/redo support', async () => {
  const latestMapViewerProps = () => (
    mockMapViewer.mock.calls[mockMapViewer.mock.calls.length - 1][0]
  );
  jest.spyOn(Math, 'random').mockReturnValue(0);
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
  getMapAnnotations.mockResolvedValue({
    path: 'factory.pgm',
    annotations: [],
  });

  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Map Editor' }));

  await waitFor(() => expect(getPgmImage).toHaveBeenCalledWith('factory.pgm'));
  await waitFor(() => expect(getMapAnnotations).toHaveBeenCalledWith('factory.pgm'));

  fireEvent.click(screen.getByRole('button', { name: 'Area' }));
  fireEvent.change(screen.getByLabelText('Area name'), {
    target: { value: 'Dock' },
  });
  await waitFor(() => expect(latestMapViewerProps().editorActive).toBe(true));

  await act(async () => {
    latestMapViewerProps().onEditorMapArea(0, 0, 0, 0);
  });

  await waitFor(() => expect(latestMapViewerProps().mapAnnotations).toEqual([
    expect.objectContaining({
      label: 'Dock',
      color: '#3B241F',
      pose: expect.objectContaining({ x: 0.5, y: 0.5 }),
      region: expect.objectContaining({
        seed_cell: { x: 0, y: 0 },
        bounds: { x_min: 0, y_min: 0, x_max: 0, y_max: 0 },
      }),
    }),
  ]));
  expect(latestMapViewerProps().editorPaintOnDrag).toBe(false);
  expect(latestMapViewerProps().editorAreaSelection).toBe(true);
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  expect(saveMapAnnotations).not.toHaveBeenCalled();

  const areaSaveCalls = saveMapAnnotations.mock.calls.length;
  await act(async () => {
    latestMapViewerProps().onEditorMapArea(0, 0, 0, 0);
  });
  expect(saveMapAnnotations).toHaveBeenCalledTimes(areaSaveCalls);
  expect(screen.getByText('Drag over an unmarked white free-space area')).toBeInTheDocument();

  await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(latestMapViewerProps().mapAnnotations).toEqual([]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(latestMapViewerProps().mapAnnotations).toEqual([
    expect.objectContaining({ label: 'Dock', color: '#3B241F' }),
  ]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveMapAnnotations).toHaveBeenCalledWith(
    'factory.pgm',
    [expect.objectContaining({ label: 'Dock', color: '#3B241F' })],
  ));
  expect(savePgmImage).not.toHaveBeenCalled();
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
  // Map name now appears both in the left-rail mission summary and the Run Session panel.
  expect(screen.getAllByText('factory').length).toBeGreaterThan(0);
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
