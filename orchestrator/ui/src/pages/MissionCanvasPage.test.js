import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MissionCanvasPage from './MissionCanvasPage';
import {
  getPgmFiles,
  getPgmImage,
  getServiceStatus,
  saveNavigationMap,
  savePgmImage,
  startNavigation,
  stopNavigation,
} from '../utils/navigationApi';
import { getNavigationSpots } from '../utils/navigationSpotsApi';

const mockMapViewer = jest.fn(() => <div>Mission Canvas Map</div>);
const mockPublishRosTopic = jest.fn();

jest.mock('../components/navigation/MapViewer', () => ({
  MapViewer: (props) => mockMapViewer(props),
}));

jest.mock('../utils/navigationApi', () => ({
  getPgmFiles: jest.fn().mockResolvedValue({ files: [] }),
  getPgmImage: jest.fn().mockResolvedValue({
    path: 'map.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  }),
  getServiceStatus: jest.fn().mockResolvedValue({ is_up: false }),
  saveNavigationMap: jest.fn().mockResolvedValue({ ok: true }),
  savePgmImage: jest.fn().mockResolvedValue({ path: 'map.pgm', saved: true }),
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
  useNavigationRosPublisher: () => mockPublishRosTopic,
}));

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockPublishRosTopic.mockResolvedValue(undefined);
  getPgmFiles.mockResolvedValue({ files: [] });
  getPgmImage.mockResolvedValue({
    path: 'map.pgm',
    width: 1,
    height: 1,
    maxval: 255,
    pixels_base64: 'AA==',
  });
  getServiceStatus.mockResolvedValue({ is_up: false });
  getNavigationSpots.mockResolvedValue({ map_name: 'map', spots: [] });
  saveNavigationMap.mockResolvedValue({ ok: true, message: 'Saved map' });
  savePgmImage.mockResolvedValue({ path: 'map.pgm', saved: true });
  startNavigation.mockResolvedValue({ ok: true });
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
  expect(lidarSwitch.parentElement).toHaveClass('justify-between');
  expect(lidarSwitch.parentElement).not.toHaveClass('border');

  fireEvent.click(lidarSwitch);
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

test('shows Spot and BT authoring panels in the authoring stage', async () => {
  render(<MissionCanvasPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Design' }));

  expect(screen.getByText('Behavior Palette')).toBeInTheDocument();
  expect(screen.getByText('Actions')).toBeInTheDocument();
  expect(screen.getByText('Controls')).toBeInTheDocument();
  expect(screen.getByText('Decorators')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'SendCommand' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sequence' })).toBeInTheDocument();
  expect(screen.getByText('Inspector')).toBeInTheDocument();
  expect(screen.getByText('Design Objects')).toBeInTheDocument();
  expect(screen.getByText('Behavior Nodes')).toBeInTheDocument();
  expect(screen.getByText('Spots')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load Map' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Map' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Spot' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Spot' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Node' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Create BT' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit BT' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Start Mapping' })).not.toBeInTheDocument();
  expect(screen.getByText('/map')).toBeInTheDocument();
  expect(screen.getByText('/bt/status')).toBeInTheDocument();
  expect(screen.getByText('/bt/active_nodes')).toBeInTheDocument();
  expect(screen.queryByText('/scan')).not.toBeInTheDocument();
  expect(screen.queryByText('/global_costmap/costmap')).not.toBeInTheDocument();
  await waitFor(() => expect(getServiceStatus).toHaveBeenCalled());
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('map'));
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
  expect(screen.getByRole('button', { name: 'Spot' })).toBeEnabled();
  await waitFor(() => expect(getNavigationSpots).toHaveBeenCalledWith('factory'));
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
    .mockResolvedValueOnce({ is_up: true })
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
  getServiceStatus.mockResolvedValueOnce({ is_up: true });

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
  const globalCostmapSwitch = screen.getByRole('switch', { name: 'Global costmap' });
  expect(globalCostmapSwitch).toHaveAttribute('aria-checked', 'true');
  expect(globalCostmapSwitch).toHaveClass('inline-flex');
  expect(globalCostmapSwitch.parentElement).toHaveClass('justify-between');
  expect(globalCostmapSwitch.parentElement).not.toHaveClass('border');

  fireEvent.click(globalCostmapSwitch);
  expect(screen.queryByText('/global_costmap/costmap')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('switch', { name: 'TF' }));
  expect(screen.getByText('/tf')).toBeInTheDocument();
  expect(screen.getByText('/tf_static')).toBeInTheDocument();

  await waitFor(() => {
    expect(mockMapViewer.mock.calls.some(([props]) => (
      props.showGlobalCostmap === true &&
      props.showLocalCostmap === true &&
      props.showGlobalPlan === true &&
      props.showGoalPose === true
    ))).toBe(true);
  });
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
