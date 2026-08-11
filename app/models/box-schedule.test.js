import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchedulePublicationStatus, isWithinSchedule } from './box-schedule.js';

const NOW = new Date('2026-08-07T12:00:00Z');

test('isWithinSchedule: no pageConfig is always visible', () => {
  assert.equal(isWithinSchedule(null, NOW), true);
});

test('isWithinSchedule: scheduleType "immediately" is always visible', () => {
  assert.equal(isWithinSchedule({ scheduleType: 'immediately', startDate: '2099-01-01' }, NOW), true);
});

test('isWithinSchedule: scheduled box before its start date is hidden', () => {
  assert.equal(
    isWithinSchedule({ scheduleType: 'scheduled', startDate: '2099-01-01', startTime: '00:00' }, NOW),
    false,
  );
});

test('isWithinSchedule: scheduled box within its window is visible', () => {
  assert.equal(
    isWithinSchedule({ scheduleType: 'scheduled', startDate: '2026-01-01', startTime: '00:00' }, NOW),
    true,
  );
});

test('isWithinSchedule: scheduled box past its end date (hasEndDate) is hidden', () => {
  assert.equal(
    isWithinSchedule({
      scheduleType: 'scheduled',
      startDate: '2026-01-01',
      startTime: '00:00',
      hasEndDate: true,
      endDate: '2026-02-01',
      endTime: '00:00',
    }, NOW),
    false,
  );
});

test('isWithinSchedule: scheduled box past its nominal end date but hasEndDate=false stays visible', () => {
  assert.equal(
    isWithinSchedule({
      scheduleType: 'scheduled',
      startDate: '2026-01-01',
      startTime: '00:00',
      hasEndDate: false,
      endDate: '2026-02-01',
      endTime: '00:00',
    }, NOW),
    true,
  );
});

test('isWithinSchedule: scheduled box without a valid start is hidden', () => {
  assert.equal(
    isWithinSchedule({ scheduleType: 'scheduled', startDate: 'not-a-date' }, NOW),
    false,
  );
});

test('getSchedulePublicationStatus: future scheduled box reports scheduled', () => {
  assert.equal(
    getSchedulePublicationStatus({ scheduleType: 'scheduled', startDate: '2099-01-01', startTime: '00:00' }, NOW),
    'scheduled',
  );
});

test('getSchedulePublicationStatus: current scheduled box reports active', () => {
  assert.equal(
    getSchedulePublicationStatus({ scheduleType: 'scheduled', startDate: '2026-01-01', startTime: '00:00' }, NOW),
    'active',
  );
});

test('getSchedulePublicationStatus: completed scheduled box reports inactive', () => {
  assert.equal(
    getSchedulePublicationStatus({
      scheduleType: 'scheduled',
      startDate: '2026-01-01',
      startTime: '00:00',
      hasEndDate: true,
      endDate: '2026-02-01',
      endTime: '00:00',
    }, NOW),
    'inactive',
  );
});
