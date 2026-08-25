import { FALLBACK_CATALOG } from './btNodeCatalogFallback';

test('defines SendCommand target controls in the fallback catalog', () => {
  const sendCommand = FALLBACK_CATALOG.find((entry) => entry.tag === 'SendCommand');

  expect(sendCommand).toBeDefined();
  expect(sendCommand.category).toBe('action');
  expect(sendCommand.ports.slice(0, 3)).toEqual([
    { name: 'target', type: 'string', default: 'INFERENCE' },
    { name: 'command', type: 'string', default: 'LOAD' },
    { name: 'model', type: 'string', default: 'lerobot:act' },
  ]);
});
