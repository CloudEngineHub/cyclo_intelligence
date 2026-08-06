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
//
// Author: Seongwoo Kim

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import clsx from 'clsx';

export default function BTActionNode({ data }) {
  const isActive = data.isActive;
  const isSelected = data.isSelected;

  return (
    <div
      className={clsx(
        'px-4 py-3 rounded-2xl border-2 min-w-[160px] text-center shadow-sm cursor-pointer',
        isActive
          ? 'border-[#c96442] bg-[#f4e5dc] ring-2 ring-[#c96442]/30 animate-pulse dark:!bg-[#3d2a20] dark:border-[#d5794f] dark:ring-[#d5794f]/40'
          : isSelected
            ? 'border-[#5b8266] bg-[#eef3ec] ring-2 ring-[#1c1a17]/20 dark:!bg-[#212c20] dark:border-[#6f9a74] dark:ring-[#ece7dd]/20'
            : 'border-[#5b8266] bg-[#eef3ec] dark:!bg-[#212c20] dark:border-[#4c6b4f]'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={clsx(isActive ? '!bg-[#c96442]' : '!bg-[#5b8266]')}
      />
      <div className="text-xs font-semibold mb-1 text-[#4f7a52] dark:text-[#8fb894]">
        {data.nodeType}
      </div>
      <div className="text-sm font-semibold text-[#1c1a17] dark:text-[#ece7dd] truncate">
        {data.label}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={clsx(isActive ? '!bg-[#c96442]' : '!bg-[#5b8266]')}
      />
    </div>
  );
}
