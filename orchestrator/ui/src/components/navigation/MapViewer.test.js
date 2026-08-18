import { fireEvent, render, screen } from '@testing-library/react';
import { MapViewer } from './MapViewer';

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

  return { ...actual, WebGLRenderer };
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
