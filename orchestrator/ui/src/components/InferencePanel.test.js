import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import InferencePanel from './InferencePanel';
import taskReducer from '../features/tasks/taskSlice';
import { InferencePhase } from '../constants/taskPhases';
import { useRosServiceCaller } from '../hooks/useRosServiceCaller';

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('../hooks/useRosServiceCaller', () => ({
  useRosServiceCaller: jest.fn(),
}));

jest.mock('./InferenceModelSelector', () => () => <div />);
jest.mock('./PolicyBackendControl', () => () => <div />);
jest.mock('./TrtEngineControl', () => () => <div />);
jest.mock('./FileBrowserModal', () => () => null);
jest.mock('./Tooltip', () => ({ children }) => <>{children}</>);

const renderPanel = ({
  inferenceMode,
  inferencePhase = InferencePhase.READY,
  initialPoseSync = true,
} = {}) => {
  useRosServiceCaller.mockReturnValue({
    sendRecordCommand: jest.fn().mockResolvedValue({ success: true }),
  });
  const initialTasks = taskReducer(undefined, { type: '@@INIT' });
  const store = configureStore({
    reducer: { tasks: taskReducer },
    preloadedState: {
      tasks: {
        ...initialTasks,
        inferenceTaskInfo: {
          ...initialTasks.inferenceTaskInfo,
          inferenceMode,
          initialPoseSync,
          initialPoseSyncDurationS: 5.0,
        },
        taskInfo: {
          ...initialTasks.taskInfo,
          inferenceMode,
          initialPoseSync,
          initialPoseSyncDurationS: 5.0,
        },
        inferenceStatus: {
          ...initialTasks.inferenceStatus,
          inferencePhase,
        },
      },
    },
  });

  render(
    <Provider store={store}>
      <InferencePanel />
    </Provider>
  );
};

describe('InferencePanel initial pose sync settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('preserves but disables initial pose sync in simulation mode', () => {
    renderPanel({ inferenceMode: 'simulation' });

    expect(screen.getByRole('checkbox', { name: 'Initial Pose Sync' }))
      .toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Initial Pose Sync' }))
      .toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Initial Pose Sync duration' }))
      .toBeDisabled();
  });

  test('allows initial pose sync editing for an idle real robot session', () => {
    renderPanel({ inferenceMode: 'robot' });

    expect(screen.getByRole('checkbox', { name: 'Initial Pose Sync' }))
      .toBeEnabled();
    expect(screen.getByRole('spinbutton', { name: 'Initial Pose Sync duration' }))
      .toBeEnabled();
  });

  test('shows duration only after initial pose sync is enabled', () => {
    renderPanel({ inferenceMode: 'robot', initialPoseSync: false });

    expect(screen.queryByRole('spinbutton', { name: 'Initial Pose Sync duration' }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Initial Pose Sync' }));

    expect(screen.getByRole('spinbutton', { name: 'Initial Pose Sync duration' }))
      .toBeEnabled();
  });

  test('makes initial pose sync settings read-only while synchronizing', () => {
    renderPanel({
      inferenceMode: 'robot',
      inferencePhase: InferencePhase.SYNCING,
    });

    expect(screen.getByRole('checkbox', { name: 'Initial Pose Sync' }))
      .toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Initial Pose Sync duration' }))
      .toBeDisabled();
  });
});
