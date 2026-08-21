import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import StandaloneBtWorkspace from './StandaloneBtWorkspace';
import { BT_UNSUPPORTED_ROBOT_MESSAGE } from '../../constants/btSupport';

jest.mock('../../features/btmanager/components/BTEditorSurface', () => {
  const React = require('react');
  return function MockBTEditorSurface({
    isActive,
    title,
    className,
    variant,
    onExitStateChange,
  }) {
    return React.createElement(
      'div',
      {
        'data-testid': 'bt-editor-surface',
        'data-active': String(isActive),
        'data-variant': variant || 'legacy',
        'data-has-exit-state-callback': String(typeof onExitStateChange === 'function'),
        className,
      },
      title,
    );
  };
});

function renderWithRobot(robotType, componentProps = {}) {
  const store = configureStore({
    reducer: {
      tasks: (state = { robotType }) => state,
    },
  });

  return render(
    <Provider store={store}>
      <StandaloneBtWorkspace {...componentProps} />
    </Provider>,
  );
}

test('renders the existing editor surface with workspace configuration', () => {
  renderWithRobot('ffw_sg2_rev1', {
    isActive: false,
    title: 'Standalone Trees',
    className: 'embedded-workspace',
  });

  const editor = screen.getByTestId('bt-editor-surface');
  expect(editor).toHaveTextContent('Standalone Trees');
  expect(editor).toHaveAttribute('data-active', 'false');
  expect(editor).toHaveClass('embedded-workspace');
});

test('forwards the Mission Canvas visual variant to the shared editor surface', () => {
  renderWithRobot('ffw_sg2_rev1', {
    variant: 'mission-canvas',
    onExitStateChange: jest.fn(),
  });

  const editor = screen.getByTestId('bt-editor-surface');
  expect(editor).toHaveAttribute('data-variant', 'mission-canvas');
  expect(editor).toHaveAttribute('data-has-exit-state-callback', 'true');
});

test('keeps the unsupported robot guard inside the reusable workspace', () => {
  renderWithRobot('ffw_sh5_rev1');

  expect(
    screen.getByRole('heading', { name: 'Behavior Trees' }),
  ).toBeInTheDocument();
  expect(screen.getByText(BT_UNSUPPORTED_ROBOT_MESSAGE)).toBeInTheDocument();
  expect(screen.getByText('Current robot type: ffw_sh5_rev1')).toBeInTheDocument();
  expect(screen.queryByTestId('bt-editor-surface')).not.toBeInTheDocument();
});
