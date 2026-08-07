// A page/pack is "scheduled" and gated by a start/end window only when
// scheduleType === 'scheduled' — otherwise (e.g. 'immediately', or missing)
// it's always visible. Unparseable dates fail open (visible) rather than
// silently hiding a box/pack due to bad data.
export function isWithinSchedule(pageConfig, now) {
  if (!pageConfig || pageConfig.scheduleType !== 'scheduled') return true;

  const referenceTime = now instanceof Date && !isNaN(now) ? now : new Date();

  if (pageConfig.startDate) {
    const start = new Date([pageConfig.startDate, pageConfig.startTime].filter(Boolean).join(' '));
    if (!isNaN(start) && referenceTime < start) return false;
  }

  if (pageConfig.hasEndDate && pageConfig.endDate) {
    const end = new Date([pageConfig.endDate, pageConfig.endTime].filter(Boolean).join(' '));
    if (!isNaN(end) && referenceTime > end) return false;
  }

  return true;
}
