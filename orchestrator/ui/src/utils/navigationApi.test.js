import {
  cancelNavigateToPoseGoal,
  getPgmImage,
  getServiceStatus,
  saveNavigationMap,
  sendInitialPoseEstimate,
  startNavigation,
} from './navigationApi';

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('uses the cyclo_intelligence same-origin navigation API', async () => {
  await getServiceStatus();

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/navigation/status',
    expect.any(Object)
  );
});

test('maps a mapping restart to the self-hosted start endpoint', async () => {
  await startNavigation('map', 'factory');

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/navigation/start',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ mode: 'map', map_name: 'factory' }),
    })
  );
});

test('saves maps with the requested basename', async () => {
  await saveNavigationMap('factory');

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/navigation/save-map',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ map_name: 'factory' }),
    })
  );
});

test('uses self-hosted endpoints for map files and action cancellation', async () => {
  await getPgmImage('warehouse/map.pgm');
  await cancelNavigateToPoseGoal();

  expect(global.fetch.mock.calls[0][0]).toBe(
    '/api/navigation/maps/pgm?path=warehouse%2Fmap.pgm'
  );
  expect(global.fetch.mock.calls[1][0]).toBe('/api/navigation/cancel');
});

test('sends initial pose estimates through the supervisor API', async () => {
  await sendInitialPoseEstimate({ x: 1.2, y: -0.4, yaw: 0.7 });

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/navigation/initial-pose',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        x: 1.2,
        y: -0.4,
        yaw: 0.7,
        frame_id: 'map',
      }),
    })
  );
});
