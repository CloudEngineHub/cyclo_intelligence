import { MODEL_OPTIONS } from './InferenceModelSelector';

test('enables GreenVLA as a selectable inference model', () => {
  const option = MODEL_OPTIONS.find((item) => item.value === 'green_vla:greenvla');

  expect(option).toMatchObject({
    label: 'GreenVLA',
    serviceType: 'green_vla',
    policyType: 'greenvla',
  });
  expect(option.comingSoon).toBeFalsy();
});

test('keeps OpenPI and RLDX-1 as coming soon models', () => {
  expect(MODEL_OPTIONS.find((item) => item.value === 'future:openpi').comingSoon).toBe(true);
  expect(MODEL_OPTIONS.find((item) => item.value === 'future:rldx1').comingSoon).toBe(true);
});
