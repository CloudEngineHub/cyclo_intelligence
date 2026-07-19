import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import BTManagerPage from './BTManagerPage';
import { BT_UNSUPPORTED_ROBOT_MESSAGE } from '../constants/btSupport';

jest.mock('../features/btmanager/components/BTEditorSurface', () => {
  const React = require('react');
  return function MockBTEditorSurface({ isActive, title }) {
    return React.createElement(
      'div',
      { 'data-testid': 'bt-editor-surface' },
      `${title}:${isActive ? 'active' : 'inactive'}`,
    );
  };
});

function renderWithRobot(robotType, props = {}) {
  const store = configureStore({
    reducer: {
      tasks: (state = { robotType }) => state,
    },
  });

  return render(
    <Provider store={store}>
      <BTManagerPage {...props} />
    </Provider>,
  );
}

test('renders reusable BT editor surface for supported robots', () => {
  renderWithRobot('ffw_sg2_rev1', { isActive: false });

  expect(screen.getByTestId('bt-editor-surface'))
    .toHaveTextContent('BT Manager:inactive');
});

test('keeps unsupported robot guard in the page wrapper', () => {
  renderWithRobot('ffw_sh5_rev1');

  expect(screen.getByText(BT_UNSUPPORTED_ROBOT_MESSAGE)).toBeInTheDocument();
  expect(screen.queryByTestId('bt-editor-surface')).not.toBeInTheDocument();
});
