import { applyDagreLayout } from './btTreeParser';

describe('applyDagreLayout', () => {
  const nodes = [
    {
      id: 'sequence',
      type: 'btControl',
      position: { x: 900, y: 700 },
      data: { label: 'Sequence_1', nodeType: 'Sequence' },
    },
    {
      id: 'command',
      type: 'btAction',
      position: { x: 1100, y: 720 },
      data: { label: 'SendCommand_1', nodeType: 'SendCommand' },
    },
  ];
  const edges = [
    { id: 'e_sequence_command', source: 'sequence', target: 'command' },
  ];

  it('keeps the requested anchor at the same canvas position', () => {
    const result = applyDagreLayout(nodes, edges, {
      respectStored: false,
      anchorNodeId: 'sequence',
    });

    const sequence = result.nodes.find((node) => node.id === 'sequence');
    const command = result.nodes.find((node) => node.id === 'command');

    expect(sequence.position).toEqual(nodes[0].position);
    expect(command.position.x).toBe(sequence.position.x);
    expect(command.position.y).toBeGreaterThan(sequence.position.y);
  });

  it('uses dagre coordinates when no anchor is requested', () => {
    const result = applyDagreLayout(nodes, edges, { respectStored: false });
    const sequence = result.nodes.find((node) => node.id === 'sequence');

    expect(sequence.position).not.toEqual(nodes[0].position);
  });
});
