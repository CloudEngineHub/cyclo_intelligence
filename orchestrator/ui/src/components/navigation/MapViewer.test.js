import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MapViewer,
  mapRenderIntervalMs,
  updateGlobalCostmapTexture,
} from './MapViewer';

const mockPointPositions = [];
const mockDataTextures = [];

jest.mock('three', () => {
  const actual = jest.requireActual('three');

  class WebGLRenderer {
    constructor() {
      this.domElement = global.document.createElement('canvas');
    }

    setPixelRatio() {}

    setClearColor() {}

    setSize() {}

    render() {}

    dispose() {}
  }

  class Points extends actual.Points {
    constructor(geometry, material) {
      super(geometry, material);
      mockPointPositions.push(Array.from(geometry.attributes.position.array));
    }
  }

  class DataTexture extends actual.DataTexture {
    constructor(...args) {
      super(...args);
      mockDataTextures.push(this);
    }
  }

  return { ...actual, DataTexture, Points, WebGLRenderer };
});

jest.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class OrbitControls {
    constructor() {
      this.target = { x: 0, y: 0, z: 0 };
    }

    update() {}

    dispose() {}
  },
}));

const waypointBtLayer = {
  spot: {
    id: 'waypoint-a',
    label: 'Waypoint A',
    pose: { x: 1, y: 2, yaw: 0 },
    linked_bt_tree: 'locals/waypoint-a.xml',
  },
  editor: <div>Waypoint BT editor</div>,
};

beforeEach(() => {
  mockPointPositions.length = 0;
  mockDataTextures.length = 0;
});

test('closes the waypoint BT split when its left 25% map context is clicked', () => {
  const onBtLayerClose = jest.fn();

  render(
    <MapViewer
      btLayer={waypointBtLayer}
      onBtLayerClose={onBtLayerClose}
      showMap={false}
    />,
  );

  const mapContext = screen.getByRole('button', {
    name: 'Back to Map from waypoint context',
  });
  expect(mapContext).toHaveClass('left-0', 'w-[25%]');

  fireEvent.click(mapContext);

  expect(onBtLayerClose).toHaveBeenCalledTimes(1);
});

test('uses adaptive map render intervals for active, idle and hidden states', () => {
  expect(mapRenderIntervalMs({ active: true })).toBe(16);
  expect(mapRenderIntervalMs({ active: false })).toBe(100);
  expect(mapRenderIntervalMs({ hidden: true, active: true })).toBe(500);
});

test('keeps the left waypoint context passive when no close action is provided', () => {
  render(<MapViewer btLayer={waypointBtLayer} showMap={false} />);

  expect(screen.queryByRole('button', {
    name: 'Back to Map from waypoint context',
  })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Waypoint BT focus canvas' }))
    .toHaveTextContent('Waypoint BT editor');
});

test('reprojects an offset laser frame when its synchronized scan pose improves', async () => {
  const scan = {
    header: { frame_id: 'base_scan', stamp: { sec: 10, nanosec: 0 } },
    ranges: [1],
    range_min: 0.02,
    range_max: 20,
    angle_min: 0,
    angle_increment: 0,
  };
  const tf = {
    transforms: [
      {
        header: { frame_id: 'map' },
        child_frame_id: 'base_link',
        transform: {
          translation: { x: 100, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      {
        header: { frame_id: 'base_link' },
        child_frame_id: 'base_scan',
        transform: {
          translation: { x: 0.2, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    ],
  };
  const { rerender } = render(
    <MapViewer
      scan={scan}
      scanPose={{ position: { x: 1, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }}
      tf={tf}
      showMap={false}
      showScan
    />,
  );

  await waitFor(() => expect(mockPointPositions.at(-1)?.[0]).toBeCloseTo(2.2));

  rerender(
    <MapViewer
      scan={scan}
      scanPose={{ position: { x: 3, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }}
      tf={tf}
      showMap={false}
      showScan
    />,
  );

  await waitFor(() => expect(mockPointPositions.at(-1)?.[0]).toBeCloseTo(4.2));
});

test('decimates lidar display rays while preserving both field-of-view edges', async () => {
  render(
    <MapViewer
      scan={{
        header: { frame_id: 'base_link' },
        ranges: [1, 1, 1, 1, 1, 1],
        range_min: 0.02,
        range_max: 20,
        angle_min: 0,
        angle_increment: Math.PI / 4,
      }}
      pose={{
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      }}
      showMap={false}
      showScan
    />,
  );

  // Six source rays become indices 0, 2, 4 and the final edge ray 5.
  await waitFor(() => expect(mockPointPositions.at(-1)).toHaveLength(12));
  const positions = mockPointPositions.at(-1);
  expect(positions.slice(0, 2)).toEqual([1, 0]);
  expect(positions[9]).toBeCloseTo(Math.cos(5 * Math.PI / 4));
  expect(positions[10]).toBeCloseTo(Math.sin(5 * Math.PI / 4));
});

test('updates only the dirty rows of an existing global costmap texture', () => {
  const THREE = jest.requireActual('three');
  const texture = new THREE.DataTexture(
    new Uint8Array(4 * 5 * 4),
    4,
    5,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  const grid = {
    info: {
      width: 4,
      height: 5,
      resolution: 0.05,
      origin: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data: [
      0, 0, 0, 0,
      0, 50, 100, 0,
      0, 25, 75, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ],
  };

  expect(updateGlobalCostmapTexture(
    texture,
    grid,
    { x: 1, y: 1, width: 2, height: 2 },
  )).toBe(true);

  expect(texture.updateRanges).toEqual([
    { start: 52, count: 8 },
    { start: 36, count: 8 },
  ]);
  // Grid (2,1)=100 maps to the vertically flipped texture: gray 70, alpha 110.
  expect(Array.from(texture.image.data.slice(52, 56))).toEqual([70, 70, 70, 110]);
  // Pixels outside the dirty rectangle remain untouched.
  expect(Array.from(texture.image.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
});

test('uses one full texture upload when a costmap delta covers a large area', () => {
  const THREE = jest.requireActual('three');
  const texture = new THREE.DataTexture(
    new Uint8Array(4 * 4 * 4),
    4,
    4,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.userData.globalCostmapFullUploadPending = false;
  const grid = {
    info: {
      width: 4,
      height: 4,
      resolution: 0.05,
      origin: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data: Array(16).fill(100),
  };

  expect(updateGlobalCostmapTexture(
    texture,
    grid,
    { x: 0, y: 0, width: 4, height: 4 },
  )).toBe(true);

  // An empty update-range list makes Three.js issue one full texSubImage2D
  // instead of one call for every row in a broad rectangle.
  expect(texture.updateRanges).toEqual([]);
  expect(texture.userData.globalCostmapFullUploadPending).toBe(true);
  expect(Array.from(texture.image.data.slice(0, 4))).toEqual([70, 70, 70, 110]);
});

test('reuses the global costmap texture for deltas and rebuilds on a full resync', async () => {
  const info = {
    width: 2,
    height: 2,
    resolution: 0.05,
    origin: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  };
  const { rerender } = render(
    <MapViewer
      globalCostmap={{ info, data: [0, 0, 0, 0] }}
      showGlobalCostmap
      showMap={false}
    />,
  );

  await waitFor(() => expect(mockDataTextures).toHaveLength(1));
  const firstTexture = mockDataTextures[0];

  rerender(
    <MapViewer
      globalCostmap={{
        info,
        data: [0, 100, 0, 0],
        updateRegion: { x: 1, y: 0, width: 1, height: 1 },
      }}
      showGlobalCostmap
      showMap={false}
    />,
  );

  await waitFor(() => expect(firstTexture.updateRanges).toHaveLength(1));
  expect(mockDataTextures).toHaveLength(1);

  rerender(
    <MapViewer
      globalCostmap={{ info, data: [0, 100, 0, 0] }}
      showGlobalCostmap
      showMap={false}
    />,
  );

  await waitFor(() => expect(mockDataTextures).toHaveLength(2));
});
