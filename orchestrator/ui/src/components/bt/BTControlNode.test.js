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

import { render } from '@testing-library/react';
import BTControlNode from './BTControlNode';

jest.mock('@xyflow/react', () => ({
  Handle: ({ className = '' }) => <span className={className} />,
  Position: {
    Top: 'top',
    Bottom: 'bottom',
  },
}));

const renderControlNode = (overrides = {}) => render(
  <BTControlNode
    id="sequence_1"
    data={{
      nodeType: 'Sequence',
      label: 'Sequence 1',
      childCount: 0,
      isActive: false,
      isSelected: false,
      ...overrides,
    }}
  />,
).container.firstElementChild;

test('keeps the normal control-node surface while selected and adds a neutral selection ring', () => {
  const node = renderControlNode({ isSelected: true });

  expect(node).toHaveClass(
    'border-[#1c1a17]',
    'bg-white',
    'dark:!bg-[#2b2823]',
    'dark:border-[#ece7dd]',
    'ring-2',
    'ring-[#1c1a17]/20',
    'dark:ring-[#ece7dd]/20',
  );
  expect(node).not.toHaveClass(
    'border-[#c96442]',
    'bg-[#f4e5dc]',
    'dark:!bg-[#3d2a20]',
    'dark:border-[#d5794f]',
  );
});

test('does not show the selection ring when the control node is not selected', () => {
  const node = renderControlNode();

  expect(node).toHaveClass(
    'border-[#1c1a17]',
    'bg-white',
    'dark:!bg-[#2b2823]',
    'dark:border-[#ece7dd]',
  );
  expect(node).not.toHaveClass(
    'ring-2',
    'ring-[#1c1a17]/20',
    'dark:ring-[#ece7dd]/20',
  );
});

test('preserves the active runtime indicator when a control node is selected', () => {
  const node = renderControlNode({ isActive: true, isSelected: true });

  expect(node).toHaveClass(
    'animate-pulse',
    'bg-white',
    'dark:!bg-[#2b2823]',
    'ring-2',
    'dark:ring-[#ece7dd]/20',
  );
});
