/**
 * v4 component library — the design-system primitives extracted from
 * overview-v4.html. Every page redesigned to the new doctrine should
 * compose from these primitives instead of inlining styles.
 *
 * Tokens (background, surface, ink, recovery, milestone, warn,
 * race) come from globals.css. Inline styles in each component
 * reference them via CSS variables.
 */

export { PrimaryButton, GhostButton } from './Buttons';
export { StatPill } from './StatPill';
export type { StatPillProps } from './StatPill';
export { SegmentsTable } from './SegmentsTable';
export type { SegmentsTableProps, SegmentRow } from './SegmentsTable';
export { IntensityBar } from './IntensityBar';
export type { IntensityBarProps } from './IntensityBar';
export { FitnessSignalRow } from './FitnessSignalRow';
export type { FitnessSignalRowProps, FitnessSignal, SignalTone } from './FitnessSignalRow';
export { ReadinessRing } from './ReadinessRing';
export type { ReadinessRingProps, ReadinessLevel } from './ReadinessRing';
export { CoachStrip } from './CoachStrip';
export type { CoachStripProps } from './CoachStrip';
export { WeekStripCard } from './WeekStripCard';
export type { WeekStripCardProps, WeekDay, DayStatus } from './WeekStripCard';
export { HeroCard } from './HeroCard';
export type { HeroCardProps, HeroStatPills } from './HeroCard';
export { Modal, ModalClose } from './Modal';
export type { ModalProps } from './Modal';
export { WorkoutDetailModal } from './WorkoutDetailModal';
export type { WorkoutDetailModalProps } from './WorkoutDetailModal';
export { ScheduleModal } from './ScheduleModal';
export type { ScheduleModalProps, ScheduleWeek, SchedulePhase, ScheduleWeekStatus } from './ScheduleModal';
