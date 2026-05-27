import { DEFAULT_PATHS } from './paths';

test('defines a GreenVLA checkpoint browser path', () => {
  expect(DEFAULT_PATHS.GREEN_VLA_CHECKPOINTS_PATH).toBe('/policy_checkpoints/green_vla');
});
