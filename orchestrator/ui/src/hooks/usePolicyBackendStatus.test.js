import { getPolicyBackendName } from './usePolicyBackendStatus';

test('maps policy service types to supervisor backend names', () => {
  expect(getPolicyBackendName('lerobot')).toBe('lerobot');
  expect(getPolicyBackendName('groot')).toBe('groot');
  expect(getPolicyBackendName('green_vla')).toBe('green_vla');
});

test('keeps unknown service types on the safe default backend', () => {
  expect(getPolicyBackendName('')).toBe('lerobot');
  expect(getPolicyBackendName('future')).toBe('lerobot');
});
