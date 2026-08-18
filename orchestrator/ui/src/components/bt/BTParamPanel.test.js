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

import { fireEvent, render, screen } from '@testing-library/react';
import BTParamPanel from './BTParamPanel';

jest.mock('react-redux', () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector) => selector({ tasks: { robotType: 'ffw_sg2' } }),
}));

jest.mock('../FileBrowserModal', () => () => null);

const node = {
  id: 'bt_1',
  data: {
    label: 'JointControl_1',
    nodeType: 'JointControl',
    params: {
      enable_head: 'false',
      enable_arms: 'true',
      enable_lift: 'false',
      duration: '2.0',
    },
  },
};

test('commits parameter drafts while typing instead of waiting for blur', () => {
  const onParamChange = jest.fn();
  render(
    <BTParamPanel
      nodes={[node]}
      selectedNodeId={node.id}
      onParamChange={onParamChange}
      onNameChange={jest.fn()}
    />,
  );

  fireEvent.change(screen.getByDisplayValue('2.0'), { target: { value: '3.5' } });

  expect(onParamChange).toHaveBeenCalledTimes(1);
  expect(onParamChange).toHaveBeenCalledWith('bt_1', 'duration', '3.5');
});

test('commits a valid node name while typing instead of waiting for blur', () => {
  const onNameChange = jest.fn();
  render(
    <BTParamPanel
      nodes={[node]}
      selectedNodeId={node.id}
      onParamChange={jest.fn()}
      onNameChange={onNameChange}
    />,
  );

  fireEvent.change(screen.getByDisplayValue('JointControl_1'), {
    target: { value: 'CloseGripper' },
  });

  expect(onNameChange).toHaveBeenCalledTimes(1);
  expect(onNameChange).toHaveBeenCalledWith('bt_1', 'CloseGripper');
});

test('restores the pre-edit node name when Escape is pressed', () => {
  const onNameChange = jest.fn();
  render(
    <BTParamPanel
      nodes={[node]}
      selectedNodeId={node.id}
      onParamChange={jest.fn()}
      onNameChange={onNameChange}
    />,
  );

  const input = screen.getByDisplayValue('JointControl_1');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'TemporaryName' } });
  fireEvent.keyDown(input, { key: 'Escape' });

  expect(input).toHaveValue('JointControl_1');
  expect(onNameChange).toHaveBeenLastCalledWith('bt_1', 'JointControl_1');
});
