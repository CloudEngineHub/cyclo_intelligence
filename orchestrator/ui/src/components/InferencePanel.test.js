import { getPolicyBrowserPath } from './InferencePanel';
import { DEFAULT_PATHS } from '../constants/paths';

test('uses the GreenVLA checkpoint folder for GreenVLA policies', () => {
  expect(getPolicyBrowserPath('green_vla')).toBe(DEFAULT_PATHS.GREEN_VLA_CHECKPOINTS_PATH);
});
