import { wrapNavigationRosMessage } from './useNavigationRosTopic';

test('wraps OccupancyGrid without losing its data and metadata fields', () => {
  const map = {
    header: { frame_id: 'map' },
    info: { width: 2, height: 1, resolution: 0.05 },
    data: [0, 100],
  };

  expect(wrapNavigationRosMessage(map)).toEqual({
    available: true,
    data: map,
  });
});
