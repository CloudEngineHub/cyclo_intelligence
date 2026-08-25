import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';

import TreeListModal from './TreeListModal';

const mockGetTreeList = jest.fn();

jest.mock('../../../hooks/useRosServiceCaller', () => ({
  useRosServiceCaller: () => ({ getTreeList: mockGetTreeList }),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

beforeEach(() => {
  mockGetTreeList.mockReset();
  toast.error.mockClear();
});

test('presents saved XML documents as tasks without exposing BT terminology', async () => {
  const onClose = jest.fn();
  const onSelect = jest.fn();
  mockGetTreeList.mockResolvedValue({
    success: true,
    tree_names: ['pick-and-place.xml'],
    tree_full_paths: ['/tasks/pick-and-place.xml'],
  });

  render(
    <TreeListModal
      isOpen
      onClose={onClose}
      onSelect={onSelect}
      variant="mission-canvas"
    />,
  );

  expect(screen.getByRole('heading', { name: 'Open Task' })).toBeInTheDocument();
  const task = await screen.findByRole('button', { name: 'pick-and-place.xml' });
  expect(screen.queryByText(/BT|behavior tree|tree XML/i)).not.toBeInTheDocument();

  fireEvent.click(task);
  expect(onSelect).toHaveBeenCalledWith({
    name: 'pick-and-place.xml',
    full_path: '/tasks/pick-and-place.xml',
  });
  expect(onClose).toHaveBeenCalled();
});

test('uses task language for empty and failed library states', async () => {
  mockGetTreeList.mockResolvedValueOnce({ success: true, tree_names: [] });
  const view = render(
    <TreeListModal isOpen onClose={jest.fn()} onSelect={jest.fn()} />,
  );

  expect(await screen.findByText('No saved tasks found')).toBeInTheDocument();

  mockGetTreeList.mockResolvedValueOnce({ success: false, message: 'offline' });
  view.rerender(
    <TreeListModal isOpen={false} onClose={jest.fn()} onSelect={jest.fn()} />,
  );
  view.rerender(
    <TreeListModal isOpen onClose={jest.fn()} onSelect={jest.fn()} />,
  );

  expect(await screen.findByText('Failed to load tasks')).toBeInTheDocument();
  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith('Failed to load tasks: offline');
  });
});
