import { requiresInstruction } from './policyCapabilities';

test('GreenVLA inference requires a task instruction', () => {
  expect(requiresInstruction('green_vla', 'greenvla')).toBe(true);
});
