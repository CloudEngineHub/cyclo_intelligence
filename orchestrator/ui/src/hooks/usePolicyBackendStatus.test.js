import {
  getPolicyBackendProcesses,
  getPolicyBackendReadiness,
} from './usePolicyBackendStatus';

const runningStatus = (name, services) => ({
  name,
  image_pulled: true,
  container_state: 'running',
  services,
});

test('uses GR00T process names for readiness', () => {
  const readiness = getPolicyBackendReadiness(
    runningStatus('groot', [
      { name: 'inference-server', state: 'up', uptime_s: 60 },
      { name: 'control-publisher', state: 'up', uptime_s: 60 },
      { name: 'main-runtime', state: 'down', uptime_s: 0 },
      { name: 'engine-process', state: 'down', uptime_s: 0 },
    ])
  );

  expect(readiness.ready).toBe(true);
  expect(readiness.state).toBe('ready');
});

test('blocks GR00T readiness when the control publisher is down', () => {
  const readiness = getPolicyBackendReadiness(
    runningStatus('groot', [
      { name: 'inference-server', state: 'up', uptime_s: 60 },
      { name: 'control-publisher', state: 'down', uptime_s: 0 },
    ])
  );

  expect(readiness.ready).toBe(false);
  expect(readiness.state).toBe('warming');
});

test('uses LeRobot runtime process names', () => {
  expect(getPolicyBackendProcesses('lerobot')).toEqual([
    { name: 'inference-server', label: 'Inference' },
    { name: 'control-publisher', label: 'Control' },
  ]);
});
