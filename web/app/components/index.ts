/**
 * faff.run React component library — barrel.
 *
 * The May 2026 design-system primitives. Import from here to keep
 * imports clean:
 *
 *   import { Topbar, Stage, Row, Card, CardPin, Greet, GreetId, GreetTile,
 *            ModalOverlay, Modal, MileChip, CoachRead, EmptyState } from '@/app/components';
 *
 * Co-located legacy components (CourseMap, ElevationChart, PhaseCards)
 * are kept exported alongside for now — they pre-date the May 2026
 * design and will be migrated to the new system in a separate pass.
 */

// Layout primitives
export { Topbar } from './Topbar';
export type { TopbarTab, TopbarProps } from './Topbar';

export { Stage } from './Stage';
export type { StageProps } from './Stage';

export { Row } from './Row';
export type { RowProps } from './Row';

export {
  Card,
  CardHeader,
  CardLabel,
  CardPin,
  CardFoot,
} from './Card';
export type {
  CardProps,
  CardHeaderProps,
  CardLabelProps,
  CardPinProps,
  CardPinVariant,
  CardFootProps,
} from './Card';

// Greet
export { Greet, GreetId, GreetState, GreetTile } from './Greet';
export type {
  GreetProps,
  GreetIdProps,
  GreetStateProps,
  GreetTileProps,
  GreetTileVariant,
} from './Greet';

// Modal
export {
  ModalOverlay,
  Modal,
  ModalHeader,
  ModalEyebrow,
  ModalClose,
  ModalBody,
  ModalFooter,
} from './Modal';
export type {
  ModalOverlayProps,
  ModalProps,
  ModalSize,
  ModalHeaderProps,
  ModalEyebrowProps,
  ModalCloseProps,
  ModalBodyProps,
  ModalFooterProps,
} from './Modal';

// Form fields
export {
  Field,
  Input,
  Textarea,
  SelectNative,
  InputWithUnit,
  ChipPick,
  ChipGroup,
  RadioRow,
  RadioList,
} from './Field';
export type {
  FieldProps,
  InputProps,
  TextareaProps,
  SelectNativeProps,
  InputWithUnitProps,
  ChipPickProps,
  ChipPickVariant,
  ChipGroupProps,
  RadioRowProps,
  RadioListProps,
} from './Field';

// Custom-painted form controls (replace native <select>, <input type=date|time|file>)
export { Dropdown, DropdownItem, DropdownGroup, DropdownSeparator } from './Dropdown';
export type {
  DropdownProps,
  DropdownItemProps,
  DropdownGroupProps,
} from './Dropdown';

export { DatePicker } from './DatePicker';
export type { DatePickerProps } from './DatePicker';

export { TimePicker } from './TimePicker';
export type { TimePickerProps, TimePickerFormat } from './TimePicker';

export { FileDrop } from './FileDrop';
export type { FileDropProps } from './FileDrop';

// States
export { EmptyState, Skeleton } from './EmptyState';
export type {
  EmptyStateProps,
  EmptyStateVariant,
  SkeletonProps,
} from './EmptyState';

// Run-detail-specific
export { MileChip } from './MileChip';
export type { MileChipProps, MileChipVariant, MileGradeKind } from './MileChip';

export { RouteMap } from './RouteMap';
export type { RouteMapProps, RouteMapPoint, RouteMapMarker } from './RouteMap';

export { ElevationGradient } from './ElevationGradient';
export type {
  ElevationGradientProps,
  ElevationPoint,
  ElevationPeak,
} from './ElevationGradient';

export { CoachRead } from './CoachRead';
export type { CoachReadProps, CoachReadDelta } from './CoachRead';
