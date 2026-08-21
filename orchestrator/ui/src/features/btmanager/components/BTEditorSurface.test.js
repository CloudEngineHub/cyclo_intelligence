// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Seongwoo Kim

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';

import BTEditorSurface from './BTEditorSurface';

const mockDispatch = jest.fn();
const mockParseBTXml = jest.fn();
const mockCallService = jest.fn();

let mockState;

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector) => selector(mockState),
}));

jest.mock('@xyflow/react', () => {
  const ReactModule = require('react');

  return {
    ReactFlow: ({ children }) => ReactModule.createElement(
      'div',
      { 'data-testid': 'react-flow-canvas' },
      children,
    ),
    Controls: () => null,
    Background: () => null,
    addEdge: (edge, edges) => [...edges, edge],
    useNodesState: (initialValue) => {
      const [nodes, setNodes] = ReactModule.useState(initialValue);
      return [nodes, setNodes, jest.fn()];
    },
    useEdgesState: (initialValue) => {
      const [edges, setEdges] = ReactModule.useState(initialValue);
      return [edges, setEdges, jest.fn()];
    },
  };
});

jest.mock('../../../components/bt/BTControlNode', () => () => null);
jest.mock('../../../components/bt/BTActionNode', () => () => null);
jest.mock('../../../components/bt/BTParamPanel', () => () => null);
jest.mock('../../../components/bt/BTNodePalette', () => ({
  __esModule: true,
  default: () => null,
  PALETTE_DRAG_MIME: 'application/x-bt-node',
}));
jest.mock('./TreeListModal', () => () => null);

jest.mock('../../../utils/btTreeParser', () => ({
  parseBTXml: (...args) => mockParseBTXml(...args),
  applyDagreLayout: (nodes, edges) => ({ nodes, edges }),
  findDeletionLayoutAnchor: () => null,
}));
jest.mock('../../../utils/btConnection', () => ({
  isValidBtConnection: () => true,
}));
jest.mock('../../../utils/btXmlSerializer', () => ({
  serializeFromGraph: () => '<root/>',
}));

jest.mock('../../../hooks/useRosServiceCaller', () => ({
  useRosServiceCaller: () => ({ callService: mockCallService }),
}));
jest.mock('../../../hooks/useBTNodeCatalog', () => ({
  useBTNodeCatalog: () => ({ catalog: [], refreshCatalog: jest.fn() }),
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
  }),
}));

const parsedTree = {
  nodes: [
    {
      id: 'root',
      type: 'btAction',
      position: { x: 0, y: 0 },
      data: { label: 'Root', nodeType: 'AlwaysSuccess', params: {} },
    },
  ],
  edges: [],
  nodeDataMap: new Map([
    ['root', { tag: 'AlwaysSuccess', name: 'Root', params: {} }],
  ]),
};

function renderEditor(variant, { isActive = false } = {}) {
  return render(
    <BTEditorSurface
      isActive={isActive}
      title="Behavior Trees"
      variant={variant}
    />,
  );
}

function mockBtNodeStatus(state) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue(JSON.stringify({
      name: 'bt_node',
      state,
      raw: state,
    })),
  });
}

function getBottomControlBar() {
  return screen.getByText(/^BT Node /).closest('.justify-between');
}

function getReactFlowCanvasSurface() {
  return screen.getByTestId('react-flow-canvas').parentElement;
}

function getHeaderButtons() {
  return [
    screen.getByTitle('Undo (Ctrl+Z)'),
    screen.getByTitle('Redo (Ctrl+Shift+Z)'),
    screen.getByTitle('Auto Layout'),
    screen.getByRole('button', { name: 'Clear current BT' }),
    screen.getByRole('button', { name: 'Save As' }),
    screen.getByRole('button', { name: 'Load XML' }),
  ];
}

beforeEach(() => {
  mockDispatch.mockClear();
  mockParseBTXml.mockReset();
  mockParseBTXml.mockReturnValue(parsedTree);
  mockCallService.mockReset();
  toast.success.mockClear();
  toast.error.mockClear();
  mockState = {
    ros: { rosbridgeUrl: 'ws://localhost:9090' },
    tasks: { robotType: 'ffw_sg2_rev1' },
    btmanager: {
      treeXml: '<root/>',
      treeFileName: 'tree.xml',
      btStatus: 'stopped',
      activeNodeNames: [],
      selectedNodeId: null,
    },
  };
  mockDispatch.mockImplementation((action) => {
    if (action?.type === 'btmanager/setTreeXml') {
      mockState.btmanager.treeXml = action.payload;
    }
    if (action?.type === 'btmanager/setTreeFileName') {
      mockState.btmanager.treeFileName = action.payload;
    }
    if (action?.type === 'btmanager/setSelectedNodeId') {
      mockState.btmanager.selectedNodeId = action.payload;
    }
    if (action?.type === 'btmanager/setBtStatus') {
      mockState.btmanager.btStatus = action.payload;
    }
    return action;
  });
});

afterEach(() => {
  jest.useRealTimers();
});

test('uses elevated Mission Canvas surfaces for every header action', async () => {
  renderEditor('mission-canvas');

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Save As' })).toBeEnabled();
  });

  getHeaderButtons().forEach((button) => {
    expect(button).toHaveClass('bg-[var(--mc-surface)]');
  });

  expect(screen.getByRole('button', { name: 'Save As' })).toHaveClass(
    'border-[var(--mc-accent)]',
    'text-[var(--mc-accent-hover)]',
  );
});

test('keeps legacy header action colors unchanged', async () => {
  renderEditor('legacy');

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Save As' })).toBeEnabled();
  });

  getHeaderButtons().forEach((button) => {
    expect(button).not.toHaveClass('bg-[var(--mc-surface)]');
  });
  expect(screen.getByTitle('Undo (Ctrl+Z)')).toHaveClass('bg-gray-100');
  expect(screen.getByRole('button', { name: 'Save As' })).toHaveClass('bg-blue-50');
  expect(screen.getByRole('button', { name: 'Load XML' })).toHaveClass('bg-gray-100');
});

test('disables the clear-current-BT control when the canvas is empty', () => {
  mockState.btmanager.treeXml = '';
  mockState.btmanager.treeFileName = '';

  renderEditor('mission-canvas');

  expect(screen.getByRole('button', { name: 'Clear current BT' })).toBeDisabled();
  expect(screen.getByText('No behavior tree loaded')).toBeInTheDocument();
});

test.each(['running', 'stopping'])(
  'disables the clear-current-BT control while BT status is %s',
  (btStatus) => {
    mockState.btmanager.btStatus = btStatus;

    renderEditor('mission-canvas');

    expect(screen.getByTestId('react-flow-canvas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear current BT' })).toBeDisabled();
  },
);

test('disarms and disables clear while a Start request is pending', async () => {
  let resolveRun;
  const runRequest = new Promise((resolve) => {
    resolveRun = resolve;
  });
  mockState.ros.rosbridgeUrl = '';
  mockBtNodeStatus('up');
  mockCallService.mockImplementation((serviceName) => {
    if (serviceName === '/bt/load_and_run') return runRequest;
    return Promise.resolve({ success: true });
  });

  renderEditor('mission-canvas', { isActive: true });

  const startButton = screen.getByRole('button', { name: 'Start' });
  await waitFor(() => expect(startButton).toBeEnabled());

  fireEvent.click(screen.getByRole('button', { name: 'Clear current BT' }));
  expect(screen.getByRole('button', { name: 'Confirm clear current BT' })).toBeEnabled();

  fireEvent.click(startButton);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Clear current BT' })).toBeDisabled();
  });
  expect(screen.queryByRole('button', { name: 'Confirm clear current BT' })).not.toBeInTheDocument();

  await act(async () => {
    resolveRun({ success: false, message: 'start rejected' });
    await runRequest;
  });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Clear current BT' })).toBeEnabled();
  });
});

test('requires a second click to clear and disarms confirmation after four seconds', () => {
  jest.useFakeTimers();
  renderEditor('mission-canvas');

  fireEvent.click(screen.getByRole('button', { name: 'Clear current BT' }));

  expect(screen.getByRole('button', { name: 'Confirm clear current BT' })).toHaveAttribute(
    'title',
    'Click again to clear the current BT',
  );
  expect(screen.getByTestId('react-flow-canvas')).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalledWith({
    type: 'btmanager/setTreeXml',
    payload: '',
  });
  expect(mockDispatch).not.toHaveBeenCalledWith({
    type: 'btmanager/setTreeFileName',
    payload: '',
  });

  act(() => {
    jest.advanceTimersByTime(4000);
  });

  expect(screen.getByRole('button', { name: 'Clear current BT' })).toBeEnabled();
  expect(screen.getByTestId('react-flow-canvas')).toBeInTheDocument();
});

test('clears the graph and persisted identity, then restores both through undo and redo', async () => {
  mockState.btmanager.selectedNodeId = 'root';
  renderEditor('mission-canvas');

  fireEvent.click(screen.getByRole('button', { name: 'Clear current BT' }));
  expect(screen.getByTestId('react-flow-canvas')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Confirm clear current BT' }));

  expect(screen.getByText('No behavior tree loaded')).toBeInTheDocument();
  expect(screen.getByText('No file loaded')).toBeInTheDocument();
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'btmanager/setSelectedNodeId',
    payload: null,
  });
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'btmanager/setTreeXml',
    payload: '',
  });
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'btmanager/setTreeFileName',
    payload: '',
  });
  expect(toast.success).toHaveBeenCalledWith('BT canvas cleared');

  const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
  expect(undoButton).toBeEnabled();
  fireEvent.click(undoButton);

  expect(screen.getByTestId('react-flow-canvas')).toBeInTheDocument();
  expect(screen.getByText('tree.xml')).toBeInTheDocument();
  await waitFor(() => expect(mockState.btmanager.treeXml).toBe('<root/>'));

  const redoButton = screen.getByTitle('Redo (Ctrl+Shift+Z)');
  expect(redoButton).toBeEnabled();
  fireEvent.click(redoButton);

  expect(screen.getByText('No behavior tree loaded')).toBeInTheDocument();
  expect(screen.getByText('No file loaded')).toBeInTheDocument();
  await waitFor(() => expect(mockState.btmanager.treeXml).toBe(''));
});

test('matches the Mission and Mapping canvas surface in the Mission BT workspace', () => {
  renderEditor('mission-canvas');

  expect(getReactFlowCanvasSurface()).toHaveClass('bg-[var(--mc-canvas)]');
  expect(getReactFlowCanvasSurface()).not.toHaveClass('bg-[var(--mc-bg)]');
});

test('keeps the legacy ReactFlow canvas background unchanged', () => {
  renderEditor('legacy');

  expect(getReactFlowCanvasSurface()).not.toHaveClass(
    'bg-[var(--mc-canvas)]',
    'bg-[var(--mc-bg)]',
  );
});

test('uses the Mission workspace surface for the bottom control bar', () => {
  renderEditor('mission-canvas');

  expect(getBottomControlBar()).toHaveClass(
    'h-14',
    'border-[var(--mc-border)]',
    'bg-[var(--mc-surface-2)]',
  );
});

test('uses sand green for enabled Mission ON and Start controls', async () => {
  const downView = renderEditor('mission-canvas');
  const onButton = screen.getByRole('button', { name: 'ON' });
  expect(onButton).toBeEnabled();
  expect(onButton).toHaveClass(
    'border-[var(--mc-success)]',
    'bg-[var(--mc-success)]',
  );
  downView.unmount();

  mockState.ros.rosbridgeUrl = '';
  mockBtNodeStatus('up');
  renderEditor('mission-canvas', { isActive: true });

  const startButton = screen.getByRole('button', { name: 'Start' });
  await waitFor(() => {
    expect(screen.getByText('BT Node Running')).toBeInTheDocument();
    expect(startButton).toBeEnabled();
  });
  expect(startButton).toHaveClass(
    'border-[var(--mc-success)]',
    'bg-[var(--mc-success)]',
  );
});

test('uses coral for enabled Mission OFF and Stop controls', async () => {
  mockState.ros.rosbridgeUrl = '';
  mockBtNodeStatus('up');
  const stoppedView = renderEditor('mission-canvas', { isActive: true });

  const offButton = screen.getByRole('button', { name: 'OFF' });
  await waitFor(() => {
    expect(screen.getByText('BT Node Running')).toBeInTheDocument();
    expect(offButton).toBeEnabled();
  });
  expect(offButton).toHaveClass(
    'border-[var(--mc-danger)]',
    'bg-[var(--mc-danger)]',
  );
  stoppedView.unmount();

  mockState.btmanager.btStatus = 'running';
  renderEditor('mission-canvas', { isActive: true });
  const stopButton = screen.getByRole('button', { name: 'Stop' });
  await waitFor(() => expect(stopButton).toBeEnabled());
  expect(stopButton).toHaveClass(
    'border-[var(--mc-danger)]',
    'bg-[var(--mc-danger)]',
  );
});

test.each([
  ['stopped', true, false],
  ['running', false, true],
  ['stopping', false, false],
  ['completed', true, false],
  ['failed', true, false],
  ['failure', true, false],
])(
  'sets Mission BT Start/Stop availability for %s status',
  async (btStatus, startEnabled, stopEnabled) => {
    mockState.ros.rosbridgeUrl = '';
    mockState.btmanager.btStatus = btStatus;
    mockBtNodeStatus('up');

    renderEditor('mission-canvas', { isActive: true });

    const startButton = screen.getByRole('button', { name: 'Start' });
    const stopButton = screen.getByRole('button', { name: 'Stop' });

    await waitFor(() => {
      expect(screen.getByText('BT Node Running')).toBeInTheDocument();
      if (startEnabled) {
        expect(startButton).toBeEnabled();
      } else {
        expect(startButton).toBeDisabled();
      }
      if (stopEnabled) {
        expect(stopButton).toBeEnabled();
      } else {
        expect(stopButton).toBeDisabled();
      }
    });
  },
);

test.each([
  ['completed', true],
  ['failed', true],
  ['running', false],
  ['stopping', false],
])(
  'sets Mission BT Node OFF availability for %s status',
  async (btStatus, offEnabled) => {
    mockState.ros.rosbridgeUrl = '';
    mockState.btmanager.btStatus = btStatus;
    mockBtNodeStatus('up');

    renderEditor('mission-canvas', { isActive: true });

    const offButton = screen.getByRole('button', { name: 'OFF' });

    await waitFor(() => {
      expect(screen.getByText('BT Node Running')).toBeInTheDocument();
      if (offEnabled) {
        expect(offButton).toBeEnabled();
      } else {
        expect(offButton).toBeDisabled();
      }
    });
  },
);

test('stops BT execution before stopping the BT Node after completion', async () => {
  mockState.ros.rosbridgeUrl = '';
  mockState.btmanager.btStatus = 'completed';
  mockCallService.mockResolvedValue({ success: true });
  mockBtNodeStatus('up');

  renderEditor('mission-canvas', { isActive: true });

  const offButton = screen.getByRole('button', { name: 'OFF' });
  await waitFor(() => expect(offButton).toBeEnabled());

  fireEvent.click(offButton);

  await waitFor(() => {
    expect(mockCallService).toHaveBeenCalledWith(
      '/bt/set_running',
      'std_srvs/srv/SetBool',
      { data: false },
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/services/bt_node/stop',
      { method: 'POST' },
    );
  });

  const supervisorStopCallIndex = global.fetch.mock.calls.findIndex(
    ([url]) => url === '/api/services/bt_node/stop',
  );
  expect(mockCallService.mock.invocationCallOrder[0]).toBeLessThan(
    global.fetch.mock.invocationCallOrder[supervisorStopCallIndex],
  );
});

test('does not stop the BT Node when terminal BT cleanup fails', async () => {
  mockState.ros.rosbridgeUrl = '';
  mockState.btmanager.btStatus = 'failed';
  mockCallService.mockResolvedValue({ success: false, message: 'cleanup failed' });
  mockBtNodeStatus('up');

  renderEditor('mission-canvas', { isActive: true });

  const offButton = screen.getByRole('button', { name: 'OFF' });
  await waitFor(() => expect(offButton).toBeEnabled());

  fireEvent.click(offButton);

  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(global.fetch.mock.calls).not.toContainEqual([
    '/api/services/bt_node/stop',
    { method: 'POST' },
  ]);
});

test.each(['completed', 'failed'])(
  'cleans up terminal %s execution before starting a new tree',
  async (btStatus) => {
    mockState.ros.rosbridgeUrl = '';
    mockState.btmanager.btStatus = btStatus;
    mockCallService.mockResolvedValue({ success: true });
    mockBtNodeStatus('up');

    renderEditor('mission-canvas', { isActive: true });

    const startButton = screen.getByRole('button', { name: 'Start' });
    await waitFor(() => expect(startButton).toBeEnabled());

    fireEvent.click(startButton);

    await waitFor(() => expect(mockCallService).toHaveBeenCalledTimes(2));
    expect(mockCallService).toHaveBeenNthCalledWith(
      1,
      '/bt/set_running',
      'std_srvs/srv/SetBool',
      { data: false },
    );
    expect(mockCallService).toHaveBeenNthCalledWith(
      2,
      '/bt/load_and_run',
      'interfaces/srv/LoadAndRunTree',
      { tree_xml: '<root/>' },
      30000,
    );
  },
);

test('keeps the legacy bottom control bar and action palette unchanged', async () => {
  const downView = renderEditor('legacy');

  expect(getBottomControlBar()).toHaveClass('py-3', 'border-black', 'bg-white');
  const onButton = screen.getByRole('button', { name: 'ON' });
  expect(onButton).toBeEnabled();
  expect(onButton).toHaveClass('bg-blue-600', 'hover:bg-blue-700', 'text-white');
  downView.unmount();

  mockState.ros.rosbridgeUrl = '';
  mockBtNodeStatus('up');
  const stoppedView = renderEditor('legacy', { isActive: true });

  const offButton = screen.getByRole('button', { name: 'OFF' });
  const startButton = screen.getByRole('button', { name: 'Start' });
  await waitFor(() => {
    expect(offButton).toBeEnabled();
    expect(startButton).toBeEnabled();
  });
  expect(offButton).toHaveClass('bg-red-600', 'hover:bg-red-700', 'text-white');
  expect(startButton).toHaveClass('bg-green-600', 'hover:bg-green-700', 'text-white');
  expect(getBottomControlBar()).not.toHaveClass('bg-[var(--mc-surface-2)]');
  stoppedView.unmount();

  mockState.btmanager.btStatus = 'running';
  renderEditor('legacy', { isActive: true });
  const stopButton = screen.getByRole('button', { name: 'Stop' });
  await waitFor(() => expect(stopButton).toBeEnabled());
  expect(stopButton).toHaveClass('bg-red-600', 'hover:bg-red-700', 'text-white');
});
