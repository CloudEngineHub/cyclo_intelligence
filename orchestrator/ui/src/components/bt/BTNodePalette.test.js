import React from 'react';
import { render, screen } from '@testing-library/react';

import BTNodePalette from './BTNodePalette';

const mockRefreshCatalog = jest.fn();

jest.mock('../../hooks/useBTNodeCatalog', () => ({
  useBTNodeCatalog: () => ({
    catalog: [
      { tag: 'Sequence', category: 'control' },
      { tag: 'Wait', category: 'action' },
    ],
    source: 'fallback',
    refreshCatalog: mockRefreshCatalog,
  }),
}));

test('labels the palette with Action Canvas terminology', () => {
  render(<BTNodePalette />);

  expect(screen.getByRole('button', { name: 'Refresh task steps' })).toHaveAttribute(
    'title',
    'Refresh available task steps',
  );
  expect(screen.getByText('Flow Controls')).toBeInTheDocument();
  expect(screen.getByText('Actions')).toBeInTheDocument();
  expect(screen.getByText('Sequence')).toBeInTheDocument();
  expect(screen.getByText('Wait')).toBeInTheDocument();
});
