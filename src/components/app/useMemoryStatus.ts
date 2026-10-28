import { useEffect, useState } from 'react';
import { loadMemory } from '../../core/memory/config.js';
import { loadGlobalMemory } from '../../core/memory/global.js';

export function useMemoryStatus(project: string | undefined, baseDir: string, panelOpen: boolean, busy: boolean) {
  const [status, setStatus] = useState({ project, enabled: false, unavailable: false });
  useEffect(() => {
    let active = true;
    if (!project) return;
    const refresh = async () => {
      const [repo, global] = await Promise.all([loadMemory(project, baseDir), loadGlobalMemory(baseDir)]);
      if (active) setStatus({ project, enabled: !!(repo.config?.enabled || global.config?.enabled), unavailable: repo.state === 'unavailable' || !!global.error });
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [project, baseDir, panelOpen, busy]);
  return status.project === project ? status : { project, enabled: false, unavailable: false };
}
