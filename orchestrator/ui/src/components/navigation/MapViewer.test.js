import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapViewer } from './MapViewer';

const mockPointPositions = [];

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

  return { ...actual, Points, WebGLRenderer };
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
