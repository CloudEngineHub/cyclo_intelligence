import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = '/api';
const DEFAULT_POLL_MS = 2000;
export const BACKEND_WARMUP_MIN_UPTIME_S = 45;

export const getPolicyBackendName = (serviceType) => (
  serviceType === 'groot' ? 'groot' : 'lerobot'
);

export const POLICY_BACKEND_PROCESSES = {
  lerobot: [
    { name: 'inference-server', label: 'Inference' },
    { name: 'control-publisher', label: 'Control' },
  ],
  groot: [
    { name: 'inference-server', label: 'Inference' },
    { name: 'control-publisher', label: 'Control' },
  ],
};

export const getPolicyBackendProcesses = (serviceType) => (
  POLICY_BACKEND_PROCESSES[getPolicyBackendName(serviceType)] ||
  POLICY_BACKEND_PROCESSES.lerobot
);

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

export function getPolicyBackendReadiness(status, options = {}) {
  const minMainUptimeS = options.minMainUptimeS ?? BACKEND_WARMUP_MIN_UPTIME_S;
  if (!status) {
    return {
      ready: false,
      state: 'checking',
      message: 'Checking backend...',
    };
  }
  if (!status.image_pulled) {
    return {
      ready: false,
      state: 'missing_image',
      message: 'Policy image is not available',
    };
  }
  if (status.container_state !== 'running') {
    return {
      ready: false,
      state: 'stopped',
      message: 'Policy Docker is off',
    };
  }

  const services = status.services || [];
  const serviceByName = Object.fromEntries(
    services.map((service) => [service.name, service])
  );
  const processes = getPolicyBackendProcesses(status.name);
  const hasStartingProcess = processes.some(
    (process) => serviceByName[process.name]?.state !== 'up'
  );
  if (hasStartingProcess) {
    return {
      ready: false,
      state: 'warming',
      message: 'Backend processes are starting...',
    };
  }

  const primary = serviceByName[processes[0].name];
  const primaryUptime = Number(primary?.uptime_s || 0);
  if (primaryUptime < minMainUptimeS) {
    const waitS = Math.max(1, Math.ceil(minMainUptimeS - primaryUptime));
    return {
      ready: false,
      state: 'warming',
      message: `Processes are up. Backend stabilizing... ${waitS}s`,
    };
  }

  return {
    ready: true,
    state: 'ready',
    message: 'Backend ready',
  };
}

export default function usePolicyBackendStatus(
  serviceType,
  { enabled = true, intervalMs = DEFAULT_POLL_MS } = {}
) {
  const backend = useMemo(() => getPolicyBackendName(serviceType), [serviceType]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshStatus = useCallback(async ({ quiet = true } = {}) => {
    if (!enabled) return null;
    if (!quiet) setIsRefreshing(true);
    try {
      const response = await fetch(`${API_BASE}/backends/${backend}/status`);
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data.detail || `status failed (${response.status})`);
      }
      setStatus(data);
      setError('');
      return data;
    } catch (err) {
      const message = err?.message || 'status failed';
      setError(message);
      setStatus({
        container_state: 'unknown',
        image_pulled: false,
        raw_state: message,
      });
      return null;
    } finally {
      if (!quiet) setIsRefreshing(false);
    }
  }, [backend, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refreshStatus({ quiet: true });
    const id = setInterval(() => refreshStatus({ quiet: true }), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, refreshStatus]);

  return {
    backend,
    status,
    error,
    isRefreshing,
    refreshStatus,
    readiness: getPolicyBackendReadiness(status),
  };
}
