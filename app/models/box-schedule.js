// A page/pack is gated by a start/end window only when scheduleType ===
// 'scheduled'. Scheduled boxes require a valid start date and time; future
// starts report "scheduled", active windows report "active", and completed
// windows report "inactive".
export function isWithinSchedule(pageConfig, now) {
  return getSchedulePublicationStatus(pageConfig, now) === 'active';
}

function parseScheduleDateTime(date, time) {
  if (!date) return null;
  const parsed = new Date([date, time].filter(Boolean).join(' '));
  return isNaN(parsed) ? null : parsed;
}

export function getSchedulePublicationStatus(pageConfig, now) {
  if (!pageConfig || pageConfig.scheduleType !== 'scheduled') return 'active';

  const referenceTime = now instanceof Date && !isNaN(now) ? now : new Date();
  const start = parseScheduleDateTime(pageConfig.startDate, pageConfig.startTime);

  // A scheduled box is not publishable until a valid start date/time exists.
  if (!start || !pageConfig.startTime) return 'inactive';
  if (referenceTime < start) return 'scheduled';

  if (pageConfig.hasEndDate && pageConfig.endDate) {
    const end = parseScheduleDateTime(pageConfig.endDate, pageConfig.endTime);
    if (end && referenceTime > end) return 'inactive';
  }

  return 'active';
}
