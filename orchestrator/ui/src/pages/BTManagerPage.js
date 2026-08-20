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
import { useSelector } from 'react-redux';
import { MdAccountTree } from 'react-icons/md';

import BTEditorSurface from '../features/btmanager/components/BTEditorSurface';
import { BT_UNSUPPORTED_ROBOT_MESSAGE, isBtRobotSupported } from '../constants/btSupport';

export default function BTManagerPage({ isActive = true }) {
  const robotType = useSelector((state) => state.tasks.robotType);
  const btRobotSupported = isBtRobotSupported(robotType);

  if (!btRobotSupported) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black bg-white">
          <h1 className="text-xl font-bold text-gray-800">BT Manager</h1>
        </div>

        <div className="flex-1 flex items-center justify-center bg-gray-50 px-6">
          <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white px-8 py-7 text-center shadow-sm">
            <MdAccountTree size={40} className="mx-auto mb-4 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900">
              {BT_UNSUPPORTED_ROBOT_MESSAGE}
            </h2>
            <p className="mt-3 text-sm text-gray-500">
              Current robot type: {robotType || 'Not selected'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <BTEditorSurface isActive={isActive} title="BT Manager" />;
}
