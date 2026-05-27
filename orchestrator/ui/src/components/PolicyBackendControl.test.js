import { getBackendLabel } from './PolicyBackendControl';

test('labels GreenVLA Docker controls explicitly', () => {
  expect(getBackendLabel('green_vla')).toBe('GreenVLA Docker');
});
