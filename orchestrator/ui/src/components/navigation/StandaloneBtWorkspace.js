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
import clsx from 'clsx';
import { useSelector } from 'react-redux';
import { MdAccountTree } from 'react-icons/md';

import BTEditorSurface from '../../features/btmanager/components/BTEditorSurface';
import {
  BT_UNSUPPORTED_ROBOT_MESSAGE,
  isBtRobotSupported,
} from '../../constants/btSupport';

export default function StandaloneBtWorkspace({
  isActive = true,
  title = 'Behavior Trees',
  className = 'w-full h-full',
  variant = 'legacy',
  onExitStateChange,
}) {
  const robotType = useSelector((state) => state.tasks.robotType);
  const btRobotSupported = isBtRobotSupported(robotType);
  const missionCanvasVariant = variant === 'mission-canvas';

  if (!btRobotSupported) {
    return (
      <div
        data-variant={variant}
        className={clsx(
          className,
          'flex flex-col',
          missionCanvasVariant && 'bg-[var(--mc-bg)] text-[var(--mc-text)]',
        )}
      >
        <div className={clsx(
          'flex items-center justify-between px-6 py-4 border-b',
          missionCanvasVariant
            ? 'border-[var(--mc-border)] bg-[var(--mc-surface)]'
            : 'border-black bg-white',
        )}>
          <h1 className={clsx(
            'font-bold',
            missionCanvasVariant ? 'text-[15px] text-[var(--mc-text)]' : 'text-xl text-gray-800',
          )}>
            {title}
          </h1>
        </div>

        <div className={clsx(
          'flex-1 flex items-center justify-center px-6',
          missionCanvasVariant ? 'bg-[var(--mc-bg)]' : 'bg-gray-50',
        )}>
          <div className={clsx(
            'w-full max-w-xl rounded-2xl border px-8 py-7 text-center shadow-sm',
            missionCanvasVariant
              ? 'border-[var(--mc-border)] bg-[var(--mc-surface)]'
              : 'border-gray-200 bg-white',
          )}>
            <MdAccountTree
              size={40}
              className={clsx(
                'mx-auto mb-4',
                missionCanvasVariant ? 'text-[var(--mc-accent)]' : 'text-gray-400',
              )}
            />
            <h2 className={clsx(
              'text-lg font-semibold',
              missionCanvasVariant ? 'text-[var(--mc-text)]' : 'text-gray-900',
            )}>
              {BT_UNSUPPORTED_ROBOT_MESSAGE}
            </h2>
            <p className={clsx(
              'mt-3 text-sm',
              missionCanvasVariant ? 'text-[var(--mc-text-muted)]' : 'text-gray-500',
            )}>
              Current robot type: {robotType || 'Not selected'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BTEditorSurface
      isActive={isActive}
      title={title}
      className={className}
      variant={variant}
      onExitStateChange={onExitStateChange}
    />
  );
}
