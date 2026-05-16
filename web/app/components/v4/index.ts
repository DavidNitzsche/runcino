/**
 * v4 component library — the design-system primitives extracted from
 * overview-v4.html. Every page redesigned to the new doctrine should
 * compose from these primitives instead of inlining styles.
 *
 * Design law: read `designs/V4_DESIGN_LAW.md`. The numeric values for
 * spacing, sizing, typography, and color are enumerated in
 * `./tokens.ts`. New components import tokens; existing ones get
 * migrated to tokens organically as they're touched.
 */

export { TOKENS, SPACING, SIZING, FONT, TYPE, COLOR, SHADOW, GRID } from './tokens';

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
