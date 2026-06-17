/*
 * Copyright 2025 ROBOTIS CO., LTD.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Author: Kiwoong Park
 */

import { createSlice } from '@reduxjs/toolkit';

// Resolved at module load so the very first render already has a valid
// rosbridge URL — child components mount with a working connection target
// instead of waiting for an effect-time dispatch.
const defaultRosHost = typeof window !== 'undefined' ? window.location.hostname : '';
const defaultRosOrigin = typeof window !== 'undefined' ? window.location.host : '';
const defaultRosScheme = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';

const buildRosbridgeUrl = (host) => {
  if (!host) return '';
  const hasPort = host.includes(':');
  const currentPort = typeof window !== 'undefined' ? window.location.port : '';
  const originHost = hasPort || !currentPort ? host : `${host}:${currentPort}`;
  return `${defaultRosScheme}://${originHost}/rosbridge`;
};

const initialState = {
  connected: false,
  connecting: false,
  rosHost: defaultRosHost,
  rosbridgeUrl: defaultRosOrigin ? `${defaultRosScheme}://${defaultRosOrigin}/rosbridge` : '',
  imageTopicList: [],
  /** Persisted camera topic assignment [left, center, right] so it survives ImageGrid remounts */
  assignedImageTopics: [],
  connectionError: null,
};

const rosSlice = createSlice({
  name: 'ros',
  initialState,
  reducers: {
    setConnected: (state, action) => {
      state.connected = action.payload;
    },
    setConnecting: (state, action) => {
      state.connecting = action.payload;
    },
    setRosHost: (state, action) => {
      state.rosHost = action.payload;
      state.rosbridgeUrl = buildRosbridgeUrl(action.payload);
    },
    setRosbridgeUrl: (state, action) => {
      state.rosbridgeUrl = action.payload;
    },
    setImageTopicList: (state, action) => {
      state.imageTopicList = action.payload;
    },
    setAssignedImageTopics: (state, action) => {
      state.assignedImageTopics = action.payload;
    },
    setConnectionError: (state, action) => {
      state.connectionError = action.payload;
    },
    resetConnection: (state) => {
      state.connected = false;
      state.connecting = false;
      state.connectionError = null;
    },
  },
});

export const {
  setConnected,
  setConnecting,
  setRosHost,
  setRosbridgeUrl,
  setImageTopicList,
  setAssignedImageTopics,
  setConnectionError,
  resetConnection,
} = rosSlice.actions;

export default rosSlice.reducer;
