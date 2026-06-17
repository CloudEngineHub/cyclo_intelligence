export const REMOTE_ZMQ_DEFAULTS = {
  remoteHost: '127.0.0.1',
  remotePort: 5555,
  remoteTimeoutMs: 300000,
};

export function shouldUseRemoteRuntime(taskInfo = {}) {
  return String(taskInfo.serviceType || '').trim().toLowerCase() === 'rldx';
}

export function withRuntimeDefaults(taskInfo = {}) {
  if (!shouldUseRemoteRuntime(taskInfo)) {
    return {
      ...taskInfo,
      remoteHost: '',
      remotePort: 0,
      remoteTimeoutMs: 0,
    };
  }

  return {
    ...taskInfo,
    remoteHost: taskInfo.remoteHost || REMOTE_ZMQ_DEFAULTS.remoteHost,
    remotePort: taskInfo.remotePort || REMOTE_ZMQ_DEFAULTS.remotePort,
    remoteTimeoutMs: taskInfo.remoteTimeoutMs || REMOTE_ZMQ_DEFAULTS.remoteTimeoutMs,
  };
}

export function getRuntimeValidationErrors(taskInfo = {}) {
  if (!shouldUseRemoteRuntime(taskInfo)) return [];

  const runtime = withRuntimeDefaults(taskInfo);
  const missingFields = [];
  const host = String(runtime.remoteHost || '').trim();
  const port = Number(runtime.remotePort || 0);
  const timeoutMs = Number(runtime.remoteTimeoutMs || 0);

  if (!host) missingFields.push('ZMQ Host');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    missingFields.push('ZMQ Port');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    missingFields.push('Timeout ms');
  }
  return missingFields;
}

export function buildRuntimeRequestFields(taskInfo = {}) {
  if (!shouldUseRemoteRuntime(taskInfo)) {
    return {
      remote_host: '',
      remote_port: 0,
      remote_timeout_ms: 0,
    };
  }

  const runtime = withRuntimeDefaults(taskInfo);
  return {
    remote_host: String(runtime.remoteHost || '').trim(),
    remote_port: Number(runtime.remotePort || 0),
    remote_timeout_ms: Number(runtime.remoteTimeoutMs || 0),
  };
}
