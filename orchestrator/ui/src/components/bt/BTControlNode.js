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

const TYPE_ICONS = {
  Sequence: '→',
  Loop: '↻',
  Fallback: '?',
  Parallel: '⇉',
};

export default function BTControlNode({ id, data }) {
  const icon = TYPE_ICONS[data.nodeType] || '□';
  const isActive = data.isActive;
  const isSelected = data.isSelected;
  const collapsed = !!data.collapsed;
  const childCount = data.childCount ?? 0;
  const hasChildren = childCount > 0;

  return (
    <div
      className={clsx(
        'relative px-4 py-3 rounded-xl border-2 min-w-[160px] text-center shadow-sm cursor-pointer',
        isSelected
          ? 'border-[#c96442] bg-[#f4e5dc] ring-2 ring-[#c96442]/30 dark:!bg-[#3d2a20] dark:border-[#d5794f] dark:ring-[#d5794f]/40'
          : 'border-[#1c1a17] bg-white dark:!bg-[#2b2823] dark:border-[#ece7dd]',
        isActive && 'animate-pulse',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#1c1a17] dark:!bg-[#ece7dd]" />
      <div className="text-xs text-[#6f6a5d] dark:text-[#9a9384] font-semibold mb-1 font-mono">
        {icon} {data.nodeType}
      </div>
      <div className="text-sm font-semibold text-[#1c1a17] dark:text-[#ece7dd] truncate">
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#1c1a17] dark:!bg-[#ece7dd]" />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!hasChildren) return;
          data.onToggleCollapse?.(id);
        }}
        disabled={!hasChildren}
        title={
          !hasChildren
            ? 'No children to collapse'
            : collapsed
              ? 'Expand'
              : 'Collapse'
        }
        className={clsx(
          'absolute -right-2 -top-2 w-5 h-5 rounded-full border bg-white dark:!bg-[#2b2823] shadow text-xs leading-none flex items-center justify-center select-none',
          hasChildren
            ? 'border-[#dcd7ca] text-[#6f6a5d] hover:bg-[#f4e5dc] hover:text-[#c96442] dark:border-[#3d3931] dark:text-[#9a9384] dark:hover:!bg-[#322e28] cursor-pointer'
            : 'border-[#e7e3d9] text-[#c3bcac] dark:border-[#322e28] dark:text-[#6e685b] cursor-not-allowed'
        )}
      >
        {collapsed ? '+' : '−'}
      </button>

      {collapsed && hasChildren && (
        <div className="absolute -bottom-2 right-1 text-[10px] text-[#6f6a5d] dark:text-[#9a9384] bg-white dark:!bg-[#2b2823] border border-[#e7e3d9] dark:border-[#322e28] rounded px-1 leading-tight">
          {childCount} hidden
        </div>
      )}
    </div>
  );
}
